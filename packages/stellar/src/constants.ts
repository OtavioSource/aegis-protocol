/**
 * @file constants.ts
 * @package @aegis/stellar
 *
 * ═══════════════════════════════════════════════════════════════
 *  STELLAR CONSTANTS — NETWORK URLs AND EXPLORER HELPERS
 * ═══════════════════════════════════════════════════════════════
 *
 * Mirrors @aegis/solana/src/constants.ts in shape to keep adapter
 * implementations consistent.
 *
 * Stellar networks:
 *   testnet — public test network. Friendbot funds accounts with 10000 XLM.
 *             Reset periodically by SDF — accounts may disappear after resets.
 *             Used by Aegis MVP.
 *   mainnet — production network. Real value. Used post-Stellar37.
 *
 * Network passphrases are required when signing transactions — they prevent
 * a tx signed for testnet from being valid on mainnet.
 */

import { Networks } from '@stellar/stellar-sdk';

export type StellarNetwork = 'stellar-testnet' | 'stellar-mainnet';

export const STELLAR_HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
export const STELLAR_HORIZON_MAINNET = 'https://horizon.stellar.org';

/** Friendbot funds testnet accounts with 10000 XLM. Devnet equivalent of airdrop. */
export const STELLAR_FRIENDBOT_URL = 'https://friendbot.stellar.org';

/**
 * Resolve the Horizon API base URL from a network identifier.
 * Allows env var override via STELLAR_HORIZON_URL for self-hosted Horizon.
 */
export function horizonUrl(network: StellarNetwork): string {
  const override = process.env['STELLAR_HORIZON_URL'];
  if (override) return override;
  return network === 'stellar-mainnet' ? STELLAR_HORIZON_MAINNET : STELLAR_HORIZON_TESTNET;
}

/**
 * Resolve the network passphrase for a given Stellar network.
 * The passphrase is hashed into the tx signature to prevent cross-network replay.
 */
export function networkPassphrase(network: StellarNetwork): string {
  return network === 'stellar-mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

// ─── Explorer URLs (stellar.expert) ──────────────────────────────────────────
// stellar.expert is the de facto Stellar explorer — equivalent to Solana Explorer.

const STELLAR_EXPERT_BASE = 'https://stellar.expert/explorer';

export function stellarExpertTxUrl(txHash: string, network: StellarNetwork): string {
  const cluster = network === 'stellar-mainnet' ? 'public' : 'testnet';
  return `${STELLAR_EXPERT_BASE}/${cluster}/tx/${txHash}`;
}

export function stellarExpertAccountUrl(address: string, network: StellarNetwork): string {
  const cluster = network === 'stellar-mainnet' ? 'public' : 'testnet';
  return `${STELLAR_EXPERT_BASE}/${cluster}/account/${address}`;
}
