/**
 * Payment execution — ramifica entre Payment direto e Path Payment Strict Receive
 * conforme o asset preferido do vendor (RF11).
 *
 * - destAsset === sourceAsset (USDC → USDC): operação `Payment`.
 * - destAsset !== sourceAsset (USDC → EURC/BRL/...): operação
 *   `PathPaymentStrictReceive` convertendo atomicamente via DEX nativa Stellar.
 *
 * Slippage: configurável por Company via `Policy.rules.pathPaymentSlippage`
 * (default 1% = 0.01). Mercado moveu além da tolerância → falha clara.
 */

import {
  Asset,
  BASE_FEE,
  type Horizon,
  type Keypair,
  Memo,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { centsToAssetString } from './assets.js';
import type { NetworkConfig } from './network.js';

export interface ExecutePaymentParams {
  horizon: Horizon.Server;
  network: NetworkConfig;
  treasuryKeypair: Keypair;
  destinationPublicKey: string;
  amountCents: number | bigint;
  /** Asset que a treasury despende (geralmente USDC). */
  sourceAsset: Asset;
  /** Asset que o vendor recebe. Igual sourceAsset → Payment direto. */
  destAsset: Asset;
  /** Tolerância de slippage (0.01 = 1%). Ignorado se destAsset === sourceAsset. */
  slippageTolerance?: number;
  /** Hash de 32 bytes a anexar como Memo.hash (ex: sha256(spendRequestId)). */
  memoHash?: Uint8Array;
}

export interface ExecutePaymentResult {
  txHash: string;
  ledger: number;
  operationType: 'payment' | 'path_payment_strict_receive';
  /** Apenas se path payment: USDC efetivamente gasto pela treasury (≤ sendMax). */
  sourceAmount?: string;
}

const DEFAULT_SLIPPAGE = 0.01;

export async function executePayment(
  params: ExecutePaymentParams,
): Promise<ExecutePaymentResult> {
  const {
    horizon,
    network,
    treasuryKeypair,
    destinationPublicKey,
    amountCents,
    sourceAsset,
    destAsset,
    slippageTolerance = DEFAULT_SLIPPAGE,
    memoHash,
  } = params;

  const treasuryAccount = await horizon.loadAccount(treasuryKeypair.publicKey());
  const destAmount = centsToAssetString(amountCents);
  const sameAsset = assetsEqual(sourceAsset, destAsset);

  const totalFee = (Number(BASE_FEE) * 2).toString();
  const txBuilder = new TransactionBuilder(treasuryAccount, {
    fee: totalFee,
    networkPassphrase: network.passphrase,
  });

  let operationType: 'payment' | 'path_payment_strict_receive';
  let sourceAmount: string | undefined;

  if (sameAsset) {
    operationType = 'payment';
    txBuilder.addOperation(
      Operation.payment({
        destination: destinationPublicKey,
        asset: destAsset,
        amount: destAmount,
      }),
    );
  } else {
    operationType = 'path_payment_strict_receive';
    const paths = await horizon
      .strictReceivePaths([sourceAsset], destAsset, destAmount)
      .call();

    if (paths.records.length === 0) {
      throw new Error(
        `No DEX liquidity for ${sourceAsset.getCode()} → ${destAsset.getCode()} ` +
          `(destAmount=${destAmount}). Check anchor liquidity or use sourceAsset directly.`,
      );
    }

    const bestPath = paths.records[0]!;
    sourceAmount = bestPath.source_amount;
    const sendMax = applySlippage(sourceAmount, slippageTolerance);

    txBuilder.addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: sourceAsset,
        sendMax,
        destination: destinationPublicKey,
        destAsset,
        destAmount,
        path: bestPath.path.map((p) => {
          // p.asset_type === 'native' (XLM) ou { asset_code, asset_issuer }
          if (p.asset_type === 'native') return Asset.native();
          return new Asset(p.asset_code as string, p.asset_issuer as string);
        }),
      }),
    );
  }

  if (memoHash) {
    txBuilder.addMemo(Memo.hash(Buffer.from(memoHash)));
  }

  const tx = txBuilder.setTimeout(60).build();
  tx.sign(treasuryKeypair);

  try {
    const result = await horizon.submitTransaction(tx);
    return { txHash: result.hash, ledger: result.ledger, operationType, sourceAmount };
  } catch (err) {
    throw new Error(extractHorizonError(err));
  }
}

/**
 * Extrai mensagem útil de um erro do Horizon.
 *
 * Horizon retorna 400 com body tipo:
 *   { extras: { result_codes: { transaction: "tx_failed", operations: ["op_underfunded"] } } }
 *
 * Esta função tenta extrair esses códigos e produz mensagem legível.
 */
export function extractHorizonError(err: unknown): string {
  const e = err as {
    response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } };
    message?: string;
  };
  const codes = e?.response?.data?.extras?.result_codes;
  if (codes) {
    const parts: string[] = [];
    if (codes.transaction) parts.push(codes.transaction);
    if (codes.operations && codes.operations.length > 0) {
      parts.push(`ops=[${codes.operations.join(',')}]`);
    }
    return `Stellar Horizon error: ${parts.join(' ')}`;
  }
  return e?.message ?? 'Unknown Stellar error';
}

/** Compara dois assets por identidade (code + issuer ou ambos native). */
export function assetsEqual(a: Asset, b: Asset): boolean {
  if (a.isNative() && b.isNative()) return true;
  if (a.isNative() || b.isNative()) return false;
  return a.getCode() === b.getCode() && a.getIssuer() === b.getIssuer();
}

/**
 * `baseAmount * (1 + slippage)` com round-up para 7 casas (precisão Stellar).
 *
 * Math em Number tem precisão suficiente para valores MVP (até ~$1M USDC).
 * Round-up garante que sendMax é sempre teto seguro (nunca abaixo do necessário).
 */
function applySlippage(baseAmount: string, slippage: number): string {
  const result = Number(baseAmount) * (1 + slippage);
  return (Math.ceil(result * 10_000_000) / 10_000_000).toFixed(7);
}
