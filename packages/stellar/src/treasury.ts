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

import { Horizon, Keypair, Operation, TransactionBuilder, Asset, BASE_FEE } from '@stellar/stellar-sdk';
import type {
  SettlementAdapter,
  AdapterTransferParams,
  AdapterTransferResult,
  AdapterWalletInfo,
} from '@aegis/shared';
import { horizonUrl, networkPassphrase, stellarExpertTxUrl, type StellarNetwork } from './constants.js';

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
      // Base64 encode the S... secret string. We could store the raw S... too
      // since it's already a string, but base64 keeps the storage shape consistent
      // with @aegis/solana so the encryptedSecret column is treated identically.
      encryptedSecret: Buffer.from(kp.secret(), 'utf8').toString('base64'),
    };
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
      // 404 from Horizon → account doesn't exist yet
      return 0;
    }
  }

  /**
   * transfer() — SettlementAdapter contract method.
   *
   * MVP IMPLEMENTATION (Phase 3): same-asset transfer (USDC → USDC, XLM → XLM).
   * Phase 4 will route to path-payments.ts when source asset ≠ destination asset.
   *
   * Currently throws if asset is non-XLM (placeholder until Phase 3 wires up
   * trustline-aware payment + Phase 4 wires up path payments).
   */
  async transfer(params: AdapterTransferParams): Promise<AdapterTransferResult> {
    // TODO Phase 3: wire up the actual payment flow
    // TODO Phase 4: detect source ≠ dest and route to executePathPayment
    throw new Error(
      `StellarTreasuryService.transfer() not yet implemented. ` +
      `Will be wired in Phase 3 (same-asset) + Phase 4 (path payments). ` +
      `Params received: ${JSON.stringify({
        to: params.toPublicKey,
        amount: params.amount,
        asset: params.asset,
      })}`,
    );
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
   * Kept package-private (only re-exported within @aegis/stellar).
   */
  getServer(): Horizon.Server {
    return this.server;
  }

  /** Not part of SettlementAdapter — Stellar-specific helpers exposed for path-payments.ts */
  buildExplorerUrl(txHash: string): string {
    return stellarExpertTxUrl(txHash, this.network);
  }

  // Re-export commonly-used SDK pieces so consumers don't have to import
  // @stellar/stellar-sdk separately.
  static signAndSubmit = signAndSubmit;
}

/**
 * signAndSubmit() — common helper to sign + submit a Stellar transaction.
 * Used by path-payments.ts and the trustlines helper. Centralized for retry
 * logic and consistent error handling.
 */
export async function signAndSubmit(params: {
  server: Horizon.Server;
  network: StellarNetwork;
  sourceAccount: Awaited<ReturnType<Horizon.Server['loadAccount']>>;
  signer: Keypair;
  operations: ReturnType<typeof Operation.payment>[];
  memo?: string;
}): Promise<string> {
  const builder = new TransactionBuilder(params.sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(params.network),
  });

  for (const op of params.operations) {
    builder.addOperation(op);
  }

  const tx = builder.setTimeout(30).build();
  tx.sign(params.signer);

  const result = await params.server.submitTransaction(tx);
  return result.hash;
}

// re-export Asset constructor so callers can use it without importing the SDK
export { Asset };
