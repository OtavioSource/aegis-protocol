/**
 * @file index.ts
 * @package @aegis/stellar
 *
 * Public entry point for the Stellar settlement adapter.
 *
 * Mirrors @aegis/solana exports so the API layer can swap implementations
 * via getSettlementAdapter() factory based on treasury.network.
 */

export { StellarTreasuryService, signAndSubmit, Asset } from './treasury.js';
export {
  horizonUrl,
  networkPassphrase,
  stellarExpertTxUrl,
  stellarExpertAccountUrl,
  STELLAR_HORIZON_TESTNET,
  STELLAR_HORIZON_MAINNET,
  STELLAR_FRIENDBOT_URL,
} from './constants.js';
export type { StellarNetwork } from './constants.js';
