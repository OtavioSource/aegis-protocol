/**
 * @file treasury.ts
 * @package @aegis/stellar
 *
 * ═══════════════════════════════════════════════════════════════
 *  STELLAR TREASURY SERVICE — HORIZON API + PATH PAYMENTS
 * ═══════════════════════════════════════════════════════════════
 *
 * StellarTreasuryService implements the SettlementAdapter interface
 * defined in @aegis/shared, mirroring the Solana TreasuryService for
 * a chain-agnostic API layer.
 *
 * Key Stellar concepts the adapter encapsulates:
 *
 *   1. KEYPAIR ENCODING — Stellar pubkeys start with G (56 chars) and secrets
 *      start with S (56 chars). We base64-encode the secret string for storage,
 *      matching the encoding scheme used by @aegis/solana.
 *
 *   2. NO ATA EQUIVALENT — In Stellar, accounts hold balances directly via
 *      "trustlines" (a record per asset the account is willing to hold).
 *      An account must explicitly trust an asset before receiving it.
 *      transfer() pre-checks the recipient has the trustline.
 *
 *   3. HORIZON REST API — Stellar's @stellar/stellar-sdk talks to a Horizon
 *      server (HTTP REST). All queries (balance, paths) go through Horizon.
 *
 *   4. KILL SWITCH ON STELLAR — Stellar lacks a direct equivalent to Solana's
 *      Token-2022 Permanent Delegate. Options:
 *        - AUTH_REVOCABLE flag + clawback (requires asset issuer to set the flag at issuance)
 *        - Multisig with low threshold weight on agent
 *        - SEP-8 regulated assets (mainnet, regulated)
 *      MVP: DB-only kill switch enforcement, with a TODO for clawback when
 *      we control the asset issuer.
 *
 *   5. PATH PAYMENTS — Stellar's killer feature. Path payments swap from one
 *      asset to another atomically via the on-ledger DEX, in a single transaction.
 *      No equivalent on Solana without aggregator + multiple txs.
 *      Implemented in path-payments.ts; transfer() routes there when source ≠ dest asset.
 */

import {
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  Asset,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import type {
  SettlementAdapter,
  AdapterTransferParams,
  AdapterTransferResult,
  AdapterWalletInfo,
} from '@aegis/shared';
import {
  horizonUrl,
  networkPassphrase,
  stellarExpertTxUrl,
  type StellarNetwork,
} from './constants.js';
import { getAsset } from './assets.js';
import { hasTrustline } from './trustlines.js';

export class StellarTreasuryService implements SettlementAdapter {
  private server: Horizon.Server;
  private network: StellarNetwork;

  constructor(network: StellarNetwork = 'stellar-testnet') {
    this.network = network;
    this.server = new Horizon.Server(horizonUrl(network));
  }

  /**
   * createWallet() — generate a new Stellar keypair for a treasury.
   *
   * The G... public key becomes the on-chain address.
   * The S... secret key is base64-encoded for storage (matching Solana adapter encoding).
   *
   * Note: The new account does NOT exist on-chain until it receives at least
   * 1 XLM (account creation reserve). On testnet, funding via Friendbot creates
   * the account. On mainnet, the treasury operator funds it manually.
   */
  createWallet(): AdapterWalletInfo {
    const kp = Keypair.random();
    return {
      publicKey: kp.publicKey(),
      // Base64 encode the S... secret string. Keeps the storage shape consistent
      // with @aegis/solana so the encryptedSecret column is treated identically.
      encryptedSecret: Buffer.from(kp.secret(), 'utf8').toString('base64'),
    };
  }

  /**
   * restoreKeypair() — reconstruct a Stellar Keypair from base64-encoded secret.
   * Private: only used internally for signing transactions.
   */
  private restoreKeypair(encryptedSecret: string): Keypair {
    const secretString = Buffer.from(encryptedSecret, 'base64').toString('utf8');
    return Keypair.fromSecret(secretString);
  }

  /**
   * getBalance() — current XLM balance of an account.
   *
   * For non-native assets (USDC, EURC), use getAssetBalance() — which reads
   * the trustline record matching that asset code + issuer.
   *
   * Returns 0 if the account doesn't exist on-chain (not yet funded).
   */
  async getBalance(walletAddress: string): Promise<number> {
    try {
      const account = await this.server.loadAccount(walletAddress);
      const native = account.balances.find((b) => b.asset_type === 'native');
      return native ? parseFloat(native.balance) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * getAssetBalance() — balance of a specific (code, issuer) asset on this account.
   *
   * Returns 0 if the account doesn't exist or has no trustline for the asset.
   * Asset-aware version of getBalance() — preferred when checking USDC/EURC.
   */
  async getAssetBalance(walletAddress: string, asset: Asset): Promise<number> {
    if (asset.isNative()) return this.getBalance(walletAddress);

    try {
      const account = await this.server.loadAccount(walletAddress);
      const match = account.balances.find((b) => {
        // Filter out native (XLM) and liquidity pool shares — only credit_alphanum4/12
        // entries carry asset_code + asset_issuer fields.
        if (b.asset_type === 'native' || b.asset_type === 'liquidity_pool_shares') return false;
        return b.asset_code === asset.code && b.asset_issuer === asset.issuer;
      });
      return match ? parseFloat(match.balance) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * transfer() — SettlementAdapter contract method.
   *
   * Phase 3 (current): same-asset transfers via Operation.payment.
   *   - XLM → XLM: native transfer
   *   - USDC → USDC: trustline-based transfer (recipient must have trustline)
   *
   * Phase 4 (future): when receiveAsset is provided and differs from asset,
   * route to path-payments.ts for cross-currency atomic swap via Stellar DEX.
   *
   * Pre-checks the recipient has a trustline for non-XLM assets — fails fast
   * with a clear error instead of submitting a doomed transaction.
   */
  async transfer(params: AdapterTransferParams): Promise<AdapterTransferResult> {
    const sourceKp = this.restoreKeypair(params.fromEncryptedSecret);
    const asset = getAsset(params.asset, this.network);

    // Pre-check: recipient must have a trustline for non-native assets.
    // Submitting without trustline would fail with op_no_trust on-chain — we
    // catch it here for a clearer error message and to save the gas.
    if (!asset.isNative()) {
      const trusted = await hasTrustline({
        server: this.server,
        accountAddress: params.toPublicKey,
        asset,
      });
      if (!trusted) {
        throw new Error(
          `Recipient ${params.toPublicKey} has no trustline for ${asset.code} ` +
            `(issuer ${asset.issuer}). The vendor must establish a trustline ` +
            `before receiving this asset.`,
        );
      }
    }

    const sourceAccount = await this.server.loadAccount(sourceKp.publicKey());

    const builder = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(this.network),
    });

    builder.addOperation(
      Operation.payment({
        destination: params.toPublicKey,
        asset,
        // Stellar represents amounts as decimal strings with up to 7 places.
        // Number → string conversion truncates safely for typical USDC values.
        amount: params.amount.toFixed(7),
      }),
    );

    const tx = builder.setTimeout(30).build();
    tx.sign(sourceKp);

    const result = await this.server.submitTransaction(tx);

    return {
      signature: result.hash,
      explorerUrl: stellarExpertTxUrl(result.hash, this.network),
    };
  }

  /**
   * freeze() — kill switch.
   *
   * MVP: DB-only enforcement (treasury.status = FROZEN already prevents new
   * transfers in the API layer). On-chain freeze options (clawback,
   * multi-sig revocation) require the issuer to set AUTH_REVOCABLE at asset
   * issuance — currently out of scope for testnet MVP.
   *
   * Logged so operators see when a freeze was triggered against a Stellar wallet.
   */
  async freeze(walletAddress: string): Promise<void> {
    console.log(
      `[aegis:stellar:freeze] Treasury ${walletAddress} frozen (DB-level enforcement only). ` +
        `On-chain clawback requires AUTH_REVOCABLE issuer flag — not enabled in MVP.`,
    );
  }

  /**
   * accountExists() — check whether the Stellar account is funded on-chain.
   * Useful before issuing operations against a fresh wallet.
   */
  async accountExists(walletAddress: string): Promise<boolean> {
    try {
      await this.server.loadAccount(walletAddress);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * getNetwork() — exposed so consumers (path-payments.ts, scripts) can build
   * explorer URLs and pick the right network passphrase.
   */
  getNetwork(): StellarNetwork {
    return this.network;
  }

  /**
   * getServer() — Horizon server reference for path-payments and other modules.
   * Kept package-scoped (only re-exported within @aegis/stellar).
   */
  getServer(): Horizon.Server {
    return this.server;
  }

  /** Stellar-specific helper exposed for path-payments.ts and scripts. */
  buildExplorerUrl(txHash: string): string {
    return stellarExpertTxUrl(txHash, this.network);
  }
}

// Re-export Asset constructor so callers can use it without importing the SDK directly.
export { Asset };
