/**
 * @file path-payments.ts
 * @package @aegis/stellar
 *
 * ═══════════════════════════════════════════════════════════════
 *  PATH PAYMENTS — STELLAR'S CROSS-CURRENCY ATOMIC SWAPS
 * ═══════════════════════════════════════════════════════════════
 *
 * Path payments are Stellar's killer feature for the Aegis use case:
 * an agent holding USDC can pay a vendor that wants EURC, in a single
 * atomic on-chain transaction. The Stellar DEX provides the liquidity
 * and the swap is bundled with the payment — either everything succeeds
 * or nothing changes.
 *
 * No equivalent exists on Solana without an external aggregator (Jupiter,
 * Orca) and multiple sequential transactions.
 *
 * ─── Strict Receive vs Strict Send ─────────────────────────────────────
 *
 * Stellar offers two path payment variants:
 *
 *   pathPaymentStrictReceive — recipient receives EXACTLY destAmount of
 *     destAsset. Sender pays UP TO sendMax of sourceAsset (slippage cap).
 *     Right for invoice-driven flows: "pay this exact bill of 25 EURC."
 *
 *   pathPaymentStrictSend — sender pays EXACTLY sendAmount of sourceAsset.
 *     Recipient receives AT LEAST destMin of destAsset.
 *     Right for "spend my entire USDC budget" flows.
 *
 * Aegis uses Strict Receive — agent invoices have a fixed amount.
 *
 * ─── The path field ────────────────────────────────────────────────────
 *
 * The `path` array lists intermediate assets the swap routes through.
 * For USDC → EURC, the path might be ['XLM'] (USDC → XLM → EURC) or
 * empty if the USDC/EURC orderbook has direct liquidity. Horizon's
 * /paths/strict-receive endpoint returns the cheapest path.
 *
 * ─── Reliability ───────────────────────────────────────────────────────
 *
 * If liquidity disappears between quote and execution (orderbook moved),
 * the tx fails with op_too_few_offers. Aegis surfaces this as a
 * SpendRequest.status = FAILED with the policy decision still APPROVED —
 * so the user can re-quote and retry without re-evaluation.
 *
 * Source: https://developers.stellar.org/docs/learn/encyclopedia/transactions-specialized/path-payments
 */

import {
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  Asset,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { networkPassphrase, type StellarNetwork } from './constants.js';

export type PathQuote = {
  /** Source asset (what the sender pays from) */
  sourceAsset: Asset;
  /** Destination asset (what the recipient gets) */
  destAsset: Asset;
  /** Exact amount the recipient receives */
  destAmount: string;
  /**
   * Maximum amount the sender will pay. Includes a slippage buffer above
   * the cheapest path. If liquidity moves and execution requires more,
   * the tx fails — protects the sender from sandwich attacks.
   */
  sendMax: string;
  /** Intermediate assets the swap routes through (may be empty) */
  path: Asset[];
  /** sourceAmount / destAmount — informational rate at quote time */
  effectiveRate: number;
};

/**
 * findStrictReceivePath() — query Horizon for the cheapest path to receive
 * exactly `destAmount` of `destAsset` paying with `sourceAsset`.
 *
 * Calls the /paths/strict-receive endpoint, which considers both direct
 * orderbooks and multi-hop routes through XLM or other liquid assets.
 *
 * Returns null if no viable path exists (no liquidity, dust amounts).
 *
 * Slippage: the returned `sendMax` is the spot quote multiplied by
 * (1 + slippageBps/10000). Default 100 bps (1%) — overridable via
 * STELLAR_SLIPPAGE_BPS env var.
 */
export async function findStrictReceivePath(params: {
  server: Horizon.Server;
  sourceAsset: Asset;
  destAsset: Asset;
  destAmount: string;
}): Promise<PathQuote | null> {
  const result = await params.server
    .strictReceivePaths([params.sourceAsset], params.destAsset, params.destAmount)
    .call();

  if (result.records.length === 0) return null;

  // Records are returned sorted by source_amount ascending — first is cheapest.
  const best = result.records[0]!;

  // Apply slippage buffer: sendMax = spotQuote * (1 + slippageBps/10000)
  const slippageBps = parseInt(process.env['STELLAR_SLIPPAGE_BPS'] ?? '100', 10);
  const spotSource = parseFloat(best.source_amount);
  const sendMaxNum = spotSource * (1 + slippageBps / 10_000);
  const sendMax = sendMaxNum.toFixed(7);

  return {
    sourceAsset: params.sourceAsset,
    destAsset: params.destAsset,
    destAmount: params.destAmount,
    sendMax,
    path: best.path.map((p) => {
      // Native (XLM) hop has no asset_code/asset_issuer
      if (p.asset_type === 'native') return Asset.native();
      return new Asset(p.asset_code as string, p.asset_issuer as string);
    }),
    effectiveRate: spotSource / parseFloat(params.destAmount),
  };
}

/**
 * executePathPayment() — submit a pathPaymentStrictReceive transaction.
 *
 * Returns the tx hash on success. Throws on submission failure (network
 * issues, insufficient balance, no path, slippage breach).
 */
export async function executePathPayment(params: {
  server: Horizon.Server;
  network: StellarNetwork;
  sourceKeypair: Keypair;
  destAddress: string;
  quote: PathQuote;
}): Promise<{ hash: string; sourceAmount: string }> {
  const sourceAccount = await params.server.loadAccount(params.sourceKeypair.publicKey());

  const builder = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(params.network),
  });

  builder.addOperation(
    Operation.pathPaymentStrictReceive({
      sendAsset: params.quote.sourceAsset,
      sendMax: params.quote.sendMax,
      destination: params.destAddress,
      destAsset: params.quote.destAsset,
      destAmount: params.quote.destAmount,
      path: params.quote.path,
    }),
  );

  const tx = builder.setTimeout(30).build();
  tx.sign(params.sourceKeypair);

  const result = await params.server.submitTransaction(tx);

  // The actual sourceAmount paid is in result_meta_xdr — but for MVP we
  // surface the sendMax as an upper bound. A future enhancement could
  // parse the tx result XDR to get the exact amount paid.
  return {
    hash: result.hash,
    sourceAmount: params.quote.sendMax,
  };
}
