/**
 * soroban-audit — helper que invoca o contrato Soroban `aegis_audit`.
 *
 * Constrói os ScVal args de `record_decision(company_id: BytesN<16>, record: DecisionRecord)`
 * e submete a transação assinada pela treasury (admin auth).
 *
 * Regras de encoding XDR (soroban-sdk v13 / Soroban 21):
 * - UUID  → BytesN<16>  : Buffer.from(uuid sem hifens, 'hex')
 * - hash  → BytesN<32>  : sha256 digest
 * - i128  : Int128Parts { hi: 0, lo: value }
 * - u64   : Uint64.fromString
 * - enum unit variant   : scvVec([scvSymbol(name)])
 * - struct (ScMap)      : entries ORDENADAS por key em ordem de byte XDR ascendente
 */

import { createHash } from 'node:crypto';

import {
  BASE_FEE,
  Contract,
  Keypair,
  rpc,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

export type SorobanDecision =
  | 'Approved'
  | 'RequiresApproval'
  | 'Rejected'
  | 'ApprovedByHuman'
  | 'RejectedByHuman'
  | 'Expired'
  | 'ExecutionFailed'
  | 'Executed';

export interface RecordDecisionParams {
  spendRequestId: string;
  agentId: string;
  vendorId: string;
  amountCents: number;
  assetCode: string;
  decision: SorobanDecision;
  reason: string;
  timestampMs: number;
  policyId: string;
  policyVersion: number;
}

export interface SorobanAuditConfig {
  contractId: string;
  sorobanRpcUrl: string;
  networkPassphrase: string;
  treasuryPublicKey: string;
  treasuryKeypair: Keypair;
}

export interface RecordDecisionResult {
  txHash: string;
  ledger: number;
}

function uuidToBuffer(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function decisionToScVal(decision: SorobanDecision): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(decision)]);
}

export function buildRecordDecisionArgs(
  companyId: string,
  record: RecordDecisionParams,
): xdr.ScVal[] {
  const reasonHash = createHash('sha256').update(record.reason).digest();

  const companyIdScVal = xdr.ScVal.scvBytes(uuidToBuffer(companyId));

  const entries: xdr.ScMapEntry[] = [
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('agent_id'),
      val: xdr.ScVal.scvBytes(uuidToBuffer(record.agentId)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('amount_cents'),
      val: xdr.ScVal.scvI128(
        new xdr.Int128Parts({
          hi: xdr.Int64.fromString('0'),
          lo: xdr.Uint64.fromString(String(record.amountCents)),
        }),
      ),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('asset_code'),
      val: xdr.ScVal.scvSymbol(record.assetCode),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('decision'),
      val: decisionToScVal(record.decision),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('policy_id'),
      val: xdr.ScVal.scvBytes(uuidToBuffer(record.policyId)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('policy_version'),
      val: xdr.ScVal.scvU32(record.policyVersion),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('reason_hash'),
      val: xdr.ScVal.scvBytes(reasonHash),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('spend_request_id'),
      val: xdr.ScVal.scvBytes(uuidToBuffer(record.spendRequestId)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('timestamp'),
      val: xdr.ScVal.scvU64(
        xdr.Uint64.fromString(String(Math.floor(record.timestampMs / 1000))),
      ),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('vendor_id'),
      val: xdr.ScVal.scvBytes(uuidToBuffer(record.vendorId)),
    }),
  ];

  // Soroban host exige ScMap entries ordenadas pelo VALOR da key, não pelo
  // XDR completo. O length-prefix do XDR muda a ordem quando as keys têm
  // comprimentos diferentes (ex.: 'amount_cents' (12) vs 'asset_code' (10)).
  entries.sort((a, b) => {
    const ka = (a.key().sym() as Buffer).toString();
    const kb = (b.key().sym() as Buffer).toString();
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const recordScVal = xdr.ScVal.scvMap(entries);

  return [companyIdScVal, recordScVal];
}

export async function invokeRecordDecision(
  config: SorobanAuditConfig,
  companyId: string,
  record: RecordDecisionParams,
): Promise<RecordDecisionResult> {
  const server = new rpc.Server(config.sorobanRpcUrl, {
    allowHttp: config.sorobanRpcUrl.startsWith('http://'),
  });
  const contract = new Contract(config.contractId);
  const args = buildRecordDecisionArgs(companyId, record);

  const sourceAccount = await server.getAccount(config.treasuryPublicKey);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call('record_decision', ...args))
    .setTimeout(60)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Soroban simulation failed: ${simResult.error}`);
  }

  const preparedTx = rpc.assembleTransaction(tx, simResult).build();
  preparedTx.sign(config.treasuryKeypair);

  const sendResult = await server.sendTransaction(preparedTx);
  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Soroban send failed: ${JSON.stringify(sendResult.errorResult)}`,
    );
  }

  const txHash = sendResult.hash;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    let statusResult: Awaited<ReturnType<typeof server.getTransaction>>;
    try {
      statusResult = await server.getTransaction(txHash);
    } catch {
      // SDK parsing pode quebrar (XDR novo do testnet vs SDK antigo).
      // A tx já foi submetida — retorna otimista com o hash; a verificação
      // on-chain pode ser feita externamente (Stellar Expert / `stellar events`).
      return { txHash, ledger: 0 };
    }
    if (statusResult.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { txHash, ledger: statusResult.ledger };
    }
    if (statusResult.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Soroban tx failed: ${txHash}`);
    }
  }

  // Polling esgotou sem SUCCESS/FAILED — devolve o hash; emit foi enviado.
  return { txHash, ledger: 0 };
}
