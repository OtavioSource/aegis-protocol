/**
 * @file assets.ts
 * @package @aegis/stellar
 *
 * ═══════════════════════════════════════════════════════════════
 *  STELLAR ASSET CONSTANTS — DEMO ISSUERS FOR TESTNET
 * ═══════════════════════════════════════════════════════════════
 *
 * Stellar represents non-native assets as (code, issuer) pairs. The same
 * "USDC" code can refer to entirely different assets depending on issuer —
 * Circle's USDC, our demo USDC, or any other issuer's USDC are distinct.
 *
 * For testnet demos, we use Aegis-controlled issuer accounts so we can:
 *   - Mint USDC/EURC on demand without depending on third-party testnet faucets
 *   - Provide deep liquidity in the USDC/EURC orderbook for path payments
 *   - Avoid issuer churn (Circle resets their testnet issuer periodically)
 *
 * Issuers are configured via env vars so the demo accounts can rotate
 * without code changes:
 *   STELLAR_DEMO_USDC_ISSUER — G... pubkey of the USDC issuer
 *   STELLAR_DEMO_EURC_ISSUER — G... pubkey of the EURC issuer
 *
 * Mainnet uses Circle's official issuers (hardcoded — Circle's mainnet
 * issuers are stable and well-known).
 */

import { Asset } from '@stellar/stellar-sdk';
import type { StellarNetwork } from './constants.js';

// Circle's official mainnet USDC issuer.
// Source: https://www.centre.io/usdc-multichain/stellar
const MAINNET_USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

// Circle's official mainnet EURC issuer (Euro Coin on Stellar).
// Source: https://www.circle.com/blog/circle-launches-euro-coin-on-stellar
const MAINNET_EURC_ISSUER = 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2';

/**
 * getAsset() — resolve an Asset object from currency code + network.
 *
 * Returns Asset.native() for XLM (no issuer needed).
 * For USDC/EURC, looks up the issuer:
 *   - Testnet: from env (STELLAR_DEMO_*_ISSUER)
 *   - Mainnet: hardcoded Circle issuer
 *
 * Throws for unknown asset codes — defensive against typos/unsupported assets.
 */
export function getAsset(code: string, network: StellarNetwork): Asset {
  if (code === 'XLM') return Asset.native();

  const isMainnet = network === 'stellar-mainnet';

  if (code === 'USDC') {
    const issuer = isMainnet
      ? MAINNET_USDC_ISSUER
      : process.env['STELLAR_DEMO_USDC_ISSUER'];
    if (!issuer) {
      throw new Error(
        'USDC on stellar-testnet requires STELLAR_DEMO_USDC_ISSUER env var. ' +
          'Run packages/stellar/src/scripts/setup-demo.ts to create a demo issuer.',
      );
    }
    return new Asset('USDC', issuer);
  }

  if (code === 'EURC') {
    const issuer = isMainnet
      ? MAINNET_EURC_ISSUER
      : process.env['STELLAR_DEMO_EURC_ISSUER'];
    if (!issuer) {
      throw new Error(
        'EURC on stellar-testnet requires STELLAR_DEMO_EURC_ISSUER env var. ' +
          'Run packages/stellar/src/scripts/setup-demo.ts to create a demo issuer.',
      );
    }
    return new Asset('EURC', issuer);
  }

  throw new Error(`Unsupported Stellar asset code: ${code}`);
}

/**
 * isNativeAsset() — convenience guard for the native XLM check.
 * Used by transfer() to skip trustline checks for XLM (no trustline needed).
 */
export function isNativeAsset(asset: Asset): boolean {
  return asset.isNative();
}
