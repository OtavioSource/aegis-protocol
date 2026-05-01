/**
 * @file settlement.ts
 * @package apps/api
 *
 * ═══════════════════════════════════════════════════════════════
 *  SETTLEMENT ADAPTER FACTORY — CHAIN-AGNOSTIC ROUTING
 * ═══════════════════════════════════════════════════════════════
 *
 * Returns the right SettlementAdapter implementation for a given network.
 * This is the integration point that makes the API layer chain-agnostic —
 * routes call getSettlementAdapter(treasury.network) instead of newing up
 * a specific TreasuryService.
 *
 * Lazy dynamic imports keep the chain SDKs out of the bundle when only one
 * is in use. A pure-Solana deployment never loads @stellar/stellar-sdk.
 *
 * Supported networks:
 *   'devnet' | 'mainnet-beta'         → @aegis/solana TreasuryService
 *   'stellar-testnet' | 'stellar-mainnet' → @aegis/stellar StellarTreasuryService
 *
 * Add a new chain by:
 *   1. Implementing SettlementAdapter in a new package (@aegis/<chain>)
 *   2. Adding the network identifier to SettlementNetworkSchema in @aegis/shared
 *   3. Adding a new branch here that lazy-imports the new package
 */

import type { SettlementAdapter } from '@aegis/shared';

export type SupportedNetwork =
  | 'devnet'
  | 'mainnet-beta'
  | 'stellar-testnet'
  | 'stellar-mainnet';

export function isSolanaNetwork(network: string): network is 'devnet' | 'mainnet-beta' {
  return network === 'devnet' || network === 'mainnet-beta';
}

export function isStellarNetwork(
  network: string,
): network is 'stellar-testnet' | 'stellar-mainnet' {
  return network === 'stellar-testnet' || network === 'stellar-mainnet';
}

/**
 * getSettlementAdapter() — factory entry point.
 *
 * Returns a SettlementAdapter ready to use for the given network. Throws
 * for unknown networks (defensive — the Zod schema should reject invalid
 * networks at the API boundary, but we double-check here for safety).
 */
export async function getSettlementAdapter(network: string): Promise<SettlementAdapter> {
  if (isSolanaNetwork(network)) {
    const { TreasuryService } = await import('@aegis/solana');
    return new TreasuryService(network);
  }

  if (isStellarNetwork(network)) {
    const { StellarTreasuryService } = await import('@aegis/stellar');
    return new StellarTreasuryService(network);
  }

  throw new Error(
    `Unknown settlement network: '${network}'. ` +
      `Supported: devnet, mainnet-beta, stellar-testnet, stellar-mainnet.`,
  );
}
