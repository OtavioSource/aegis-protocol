/**
 * @file trustlines.ts
 * @package @aegis/stellar
 *
 * ═══════════════════════════════════════════════════════════════
 *  TRUSTLINES — STELLAR'S OPT-IN ASSET MODEL
 * ═══════════════════════════════════════════════════════════════
 *
 * In Stellar, an account must explicitly "trust" an asset before it can
 * receive or hold that asset. This is unlike Solana, where Associated
 * Token Accounts (ATAs) are created on demand by the sender.
 *
 * A trustline is a record on the account stating:
 *   "I, account G..., trust issuer GISSUER... to hold their asset CODE."
 *
 * Trustlines cost 0.5 XLM in reserve (locked, refundable when removed).
 *
 * Aegis usage:
 *   - Treasury creation: establish trustlines for the assets the treasury
 *     will receive (USDC for inbound funding).
 *   - Vendor onboarding: vendor must establish their own trustlines —
 *     Aegis cannot do this for them (only the account owner can). Aegis
 *     pre-checks before path payment execution and fails clearly if missing.
 *
 * Source: https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#trustlines
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

/**
 * establishTrustline() — open a trustline from `account` to hold `asset`.
 *
 * The account must already exist on-chain (funded with at least 1.5 XLM —
 * 1 for base reserve + 0.5 for the new trustline reserve).
 *
 * Returns the tx hash of the changeTrust operation.
 */
export async function establishTrustline(params: {
  server: Horizon.Server;
  network: StellarNetwork;
  account: Keypair;
  asset: Asset;
  /** Optional explicit limit. Default: max (effectively unlimited) */
  limit?: string;
}): Promise<string> {
  const sourceAccount = await params.server.loadAccount(params.account.publicKey());

  const builder = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(params.network),
  });

  builder.addOperation(
    Operation.changeTrust({
      asset: params.asset,
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
    }),
  );

  const tx = builder.setTimeout(30).build();
  tx.sign(params.account);

  const result = await params.server.submitTransaction(tx);
  return result.hash;
}

/**
 * hasTrustline() — check if `account` has an active trustline for `asset`.
 *
 * Used by transfer() to fail fast with a clear error instead of submitting
 * a transaction that the network will reject.
 *
 * Returns false if the account doesn't exist, or if no matching trustline
 * is found in the account's balances list.
 */
export async function hasTrustline(params: {
  server: Horizon.Server;
  accountAddress: string;
  asset: Asset;
}): Promise<boolean> {
  if (params.asset.isNative()) return true;  // XLM never needs a trustline

  try {
    const account = await params.server.loadAccount(params.accountAddress);
    return account.balances.some((b) => {
      // Narrow the union: native (XLM) and liquidity pool shares don't have
      // asset_code/asset_issuer. Only credit_alphanum4/12 entries do.
      if (b.asset_type === 'native' || b.asset_type === 'liquidity_pool_shares') return false;
      return (
        b.asset_code === params.asset.code &&
        b.asset_issuer === params.asset.issuer
      );
    });
  } catch {
    // 404 — account doesn't exist on-chain
    return false;
  }
}
