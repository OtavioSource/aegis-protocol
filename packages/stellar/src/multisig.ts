/**
 * Setup multisig de carteira não-custodial (ADR 0007 §3, §7).
 *
 * Matriz (validada na testnet — `scripts/proto-multisig.ts`):
 *   master (dono) peso 3 | agent peso 1 | aegis peso 1 ; low=1 med=2 high=3
 *   → pagamento (med=2) exige agent+aegis; reconfig (high=3) só a master do dono.
 *
 * A tx de setup é construída pelo Aegis e tem como **source/sequence a conta
 * operacional do Aegis (sponsor)**, que também patrocina as reserves (CAP-33).
 * As operações que mexem na conta do dono têm `source = ownerAddress` e exigem
 * a assinatura do **dono** (client-side / Freighter). Portanto a tx volta
 * assinada só pelo sponsor; o dono adiciona a 2ª assinatura e então se submete.
 *
 * Autorização: as ops `setOptions` (high) são avaliadas contra os thresholds
 * ANTERIORES (conta nova/recém-criada → high=0), então a master peso 1 já basta
 * para o setup; ao final os thresholds passam a low=1/med=2/high=3.
 */

import {
  type Asset,
  BASE_FEE,
  type Horizon,
  Keypair,
  Memo,
  Operation,
  type Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import type { NetworkConfig } from './network.js';
import { assetsEqual, extractHorizonError } from './payment.js';

export const WALLET_MASTER_WEIGHT = 3;
export const WALLET_SIGNER_WEIGHT = 1;
export const WALLET_THRESHOLDS = { low: 1, medium: 2, high: 3 } as const;

export interface BuildWalletSetupParams {
  horizon: Horizon.Server;
  network: NetworkConfig;
  /** Conta operacional do Aegis: source/sequence da tx e sponsor das reserves. */
  sponsorKeypair: Keypair;
  /** Endereço (master pubkey) do dono da carteira. */
  ownerAddress: string;
  /**
   * `true` quando a conta do dono ainda não existe on-chain (modo GENERATED) →
   * o sponsor cria a conta (startingBalance 0) na mesma tx.
   */
  createOwnerAccount: boolean;
  /** Pubkey do co-signer do Aegis para esta company (derivada — ver aegis-signer.ts). */
  aegisSignerPubKey: string;
  /** Pubkeys dos agentes que poderão assinar nesta carteira (peso 1 cada). */
  agentSignerPubKeys: string[];
  /** Asset USDC para abrir trustline na conta do dono (opcional). */
  usdcAsset?: Asset;
}

export interface WalletSetupBuildResult {
  /** Tx já assinada pelo sponsor; falta a assinatura do dono. Use `.toXDR()`. */
  transaction: Transaction;
  /** XLM que o sponsor trava em reserves (0.5 por signer/trustline + 0.5 se criar conta). */
  xlmSponsored: string;
}

/**
 * Constrói (e assina como sponsor) a tx de setup multisig de uma carteira.
 * O caller obtém o XDR (`result.transaction.toXDR()`), o dono assina, e então
 * submete-se ao Horizon.
 */
export async function buildWalletSetupTransaction(
  params: BuildWalletSetupParams,
): Promise<WalletSetupBuildResult> {
  const {
    horizon,
    network,
    sponsorKeypair,
    ownerAddress,
    createOwnerAccount,
    aegisSignerPubKey,
    agentSignerPubKeys,
    usdcAsset,
  } = params;

  if (agentSignerPubKeys.length === 0) {
    throw new Error('buildWalletSetupTransaction: ao menos um agentSignerPubKey é necessário.');
  }
  // master + aegis + agents ≤ 20 signers por conta (limite Stellar).
  const totalSigners = 2 + agentSignerPubKeys.length;
  if (totalSigners > 20) {
    throw new Error(`Limite de 20 signers por conta excedido (${totalSigners}).`);
  }

  const sponsorAccount = await horizon.loadAccount(sponsorKeypair.publicKey());

  // Contagem de operações para o fee.
  const opCount =
    1 + // beginSponsoring
    (createOwnerAccount ? 1 : 0) +
    agentSignerPubKeys.length + // add agent signers
    1 + // add aegis signer
    (usdcAsset ? 1 : 0) + // changeTrust
    1 + // thresholds + masterWeight
    1; // endSponsoring
  const fee = Math.ceil(Number(BASE_FEE) * opCount * 1.5).toString();

  const builder = new TransactionBuilder(sponsorAccount, {
    fee,
    networkPassphrase: network.passphrase,
  });

  // 1. Sponsor começa a patrocinar as reserves futuras da conta do dono.
  builder.addOperation(
    Operation.beginSponsoringFutureReserves({ sponsoredId: ownerAddress }),
  );

  // 2. (modo GENERATED) sponsor cria a conta do dono com 0 XLM próprio.
  if (createOwnerAccount) {
    builder.addOperation(
      Operation.createAccount({ destination: ownerAddress, startingBalance: '0' }),
    );
  }

  // 3. Adiciona os signers dos agentes (peso 1) — source = dono.
  for (const agentPub of agentSignerPubKeys) {
    builder.addOperation(
      Operation.setOptions({
        source: ownerAddress,
        signer: { ed25519PublicKey: agentPub, weight: WALLET_SIGNER_WEIGHT },
      }),
    );
  }

  // 4. Adiciona o co-signer do Aegis (peso 1) — source = dono.
  builder.addOperation(
    Operation.setOptions({
      source: ownerAddress,
      signer: { ed25519PublicKey: aegisSignerPubKey, weight: WALLET_SIGNER_WEIGHT },
    }),
  );

  // 5. (opcional) trustline USDC na conta do dono — source = dono.
  if (usdcAsset) {
    builder.addOperation(Operation.changeTrust({ source: ownerAddress, asset: usdcAsset }));
  }

  // 6. Define masterWeight=3 e thresholds low=1/med=2/high=3 — source = dono.
  //    (avaliado contra thresholds anteriores; por isso vem por último.)
  builder.addOperation(
    Operation.setOptions({
      source: ownerAddress,
      masterWeight: WALLET_MASTER_WEIGHT,
      lowThreshold: WALLET_THRESHOLDS.low,
      medThreshold: WALLET_THRESHOLDS.medium,
      highThreshold: WALLET_THRESHOLDS.high,
    }),
  );

  // 7. Encerra o patrocínio — source = dono.
  builder.addOperation(Operation.endSponsoringFutureReserves({ source: ownerAddress }));

  const transaction = builder.setTimeout(300).build();
  // Sponsor assina agora (ops cujo source é o sponsor: begin + createAccount).
  // A assinatura do dono (ops source=owner) é adicionada client-side depois.
  transaction.sign(sponsorKeypair);

  // 0.5 XLM por signer adicionado + 0.5 por trustline + 0.5 se criar conta.
  const reserveEntries =
    agentSignerPubKeys.length + 1 + (usdcAsset ? 1 : 0) + (createOwnerAccount ? 1 : 0);
  const xlmSponsored = (reserveEntries * 0.5).toFixed(7);

  return { transaction, xlmSponsored };
}

// ===========================================================================
// Pagamento two-phase (fluxo 5a — ADR 0007 §5/§6)
//   1. Aegis constrói o envelope canônico (não assina).
//   2. Agente assina client-side.
//   3. Aegis valida o envelope (igualdade ao esperado), verifica a assinatura
//      do agente, co-assina e submete.
// ===========================================================================

export interface BuildPaymentEnvelopeParams {
  horizon: Horizon.Server;
  network: NetworkConfig;
  /** Conta de origem = endereço da carteira (master pubkey do dono). Source/sequence da tx. */
  walletAddress: string;
  /** Wallet do vendor (destino do pagamento). */
  destination: string;
  /** Asset do pagamento (USDC). */
  asset: Asset;
  /** Valor em formato Stellar (use `centsToAssetString`). */
  amount: string;
  /** Hash de 32 bytes para Memo.hash — ex.: sha256(spendRequestId). */
  memoHash: Uint8Array;
  /** TTL do challenge em segundos (default 300 = 5 min). */
  timeoutSecs?: number;
}

/**
 * Constrói o envelope canônico de pagamento (XDR **não-assinado**). O Aegis
 * monta; o agente assina depois (client-side). Carrega a sequence da carteira.
 */
export async function buildPaymentEnvelope(
  params: BuildPaymentEnvelopeParams,
): Promise<string> {
  const { horizon, network, walletAddress, destination, asset, amount, memoHash } = params;
  const account = await horizon.loadAccount(walletAddress);
  const tx = new TransactionBuilder(account, {
    fee: (Number(BASE_FEE) * 2).toString(),
    networkPassphrase: network.passphrase,
  })
    .addOperation(Operation.payment({ destination, asset, amount }))
    .addMemo(Memo.hash(Buffer.from(memoHash)))
    .setTimeout(params.timeoutSecs ?? 300)
    .build();
  return tx.toXDR();
}

export interface ValidatePaymentEnvelopeParams {
  signedXdr: string;
  networkPassphrase: string;
  expectedSource: string;
  expectedDestination: string;
  expectedAsset: Asset;
  expectedAmount: string;
  expectedMemoHash: Uint8Array;
  /** Pubkey do agente que deve ter assinado este envelope. */
  expectedAgentSignerPubKey: string;
}

/**
 * Validação §6 do ADR — o Aegis NUNCA assina às cegas. Confere que o envelope
 * assinado bate exatamente com o esperado (1 op payment, source/destino/asset/
 * amount/memo) e que a assinatura do agente está presente e é válida.
 * Lança `Error` em qualquer divergência (falha fechada). Retorna a `Transaction`.
 */
export function validatePaymentEnvelope(params: ValidatePaymentEnvelopeParams): Transaction {
  const tx = TransactionBuilder.fromXDR(params.signedXdr, params.networkPassphrase);
  if ('innerTransaction' in tx) throw new Error('fee-bump inesperado no envelope');

  if (tx.source !== params.expectedSource) {
    throw new Error(`envelope source divergente: ${tx.source}`);
  }
  if (tx.operations.length !== 1) {
    throw new Error(`envelope deve ter exatamente 1 operação, veio ${tx.operations.length}`);
  }
  const op = tx.operations[0]!;
  if (op.type !== 'payment') throw new Error(`operação inesperada no envelope: ${op.type}`);
  if (op.source && op.source !== params.expectedSource) {
    throw new Error('op.source override suspeito no envelope');
  }
  if (op.destination !== params.expectedDestination) {
    throw new Error(`destino divergente: ${op.destination}`);
  }
  if (op.amount !== params.expectedAmount) {
    throw new Error(`amount divergente: ${op.amount} (esperado ${params.expectedAmount})`);
  }
  if (!assetsEqual(op.asset, params.expectedAsset)) {
    throw new Error('asset divergente no envelope');
  }
  const memo = tx.memo;
  if (memo.type !== 'hash' || !Buffer.from(memo.value as Buffer).equals(Buffer.from(params.expectedMemoHash))) {
    throw new Error('memo divergente no envelope');
  }

  // Assinatura do agente presente e válida sobre o hash desta tx.
  const agentKp = Keypair.fromPublicKey(params.expectedAgentSignerPubKey);
  const hash = tx.hash();
  const agentSigned = tx.signatures.some((s) => {
    try {
      return agentKp.verify(hash, s.signature());
    } catch {
      return false;
    }
  });
  if (!agentSigned) {
    throw new Error('assinatura do agente ausente ou inválida no envelope');
  }

  return tx;
}

export interface CosignAndSubmitPaymentParams extends ValidatePaymentEnvelopeParams {
  horizon: Horizon.Server;
  /** Keypair do co-signer do Aegis (derivada da company). */
  aegisKeypair: Keypair;
}

export interface CosignAndSubmitResult {
  txHash: string;
  ledger: number;
}

/**
 * Valida o envelope (§6), co-assina com a chave do Aegis e submete ao Horizon.
 * Lança em validação ou erro do Horizon (caller mapeia para EXECUTION_FAILED).
 */
export async function cosignAndSubmitPayment(
  params: CosignAndSubmitPaymentParams,
): Promise<CosignAndSubmitResult> {
  const tx = validatePaymentEnvelope(params);
  tx.sign(params.aegisKeypair);
  try {
    const result = await params.horizon.submitTransaction(tx);
    return { txHash: result.hash, ledger: result.ledger };
  } catch (err) {
    throw new Error(extractHorizonError(err));
  }
}

export interface CosignMatchingEnvelopeParams {
  horizon: Horizon.Server;
  networkPassphrase: string;
  /** Co-signer do Aegis (derivado da company). */
  aegisKeypair: Keypair;
  /** Envelope canônico **não-assinado** que o Aegis emitiu e persistiu. */
  expectedEnvelopeXdr: string;
  /** Envelope devolvido pelo agente, já assinado por ele. */
  signedXdr: string;
  /** Pubkey do agente que deve ter assinado. */
  expectedAgentSignerPubKey: string;
}

/**
 * Variante "igualdade ao challenge" (ADR 0007 §6): em vez de validar campo a
 * campo, exige que o envelope assinado seja **exatamente** o emitido (mesmo
 * hash de transação — pina destino, valor, asset, memo, fee, sequence e
 * timeBounds de uma vez). Verifica a assinatura do agente, co-assina e submete.
 */
export async function cosignMatchingEnvelope(
  params: CosignMatchingEnvelopeParams,
): Promise<CosignAndSubmitResult> {
  const expected = TransactionBuilder.fromXDR(params.expectedEnvelopeXdr, params.networkPassphrase);
  const signed = TransactionBuilder.fromXDR(params.signedXdr, params.networkPassphrase);
  if ('innerTransaction' in signed || 'innerTransaction' in expected) {
    throw new Error('fee-bump inesperado');
  }
  if (!expected.hash().equals(signed.hash())) {
    throw new Error('envelope assinado diverge do emitido (hash diferente)');
  }
  const agentKp = Keypair.fromPublicKey(params.expectedAgentSignerPubKey);
  const hash = signed.hash();
  const agentSigned = signed.signatures.some((s) => {
    try {
      return agentKp.verify(hash, s.signature());
    } catch {
      return false;
    }
  });
  if (!agentSigned) throw new Error('assinatura do agente ausente ou inválida');

  signed.sign(params.aegisKeypair);
  try {
    const result = await params.horizon.submitTransaction(signed);
    return { txHash: result.hash, ledger: result.ledger };
  } catch (err) {
    throw new Error(extractHorizonError(err));
  }
}
