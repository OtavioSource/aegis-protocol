/**
 * @file treasury.ts
 * @package @aegis/solana
 *
 * ═══════════════════════════════════════════════════════════════
 *  TREASURY SERVICE — SOLANA WALLET AND SPL TOKEN OPERATIONS
 * ═══════════════════════════════════════════════════════════════
 *
 * This file is the Solana integration core of Aegis Protocol.
 * All blockchain operations are isolated here — no @solana/web3.js
 * or @solana/spl-token imports exist anywhere outside this package.
 *
 * Design principles:
 *
 *   1. ADAPTER ISOLATION — The rest of the system (API routes, policy engine)
 *      never imports Solana SDK directly. TreasuryService is the only entry point.
 *      This makes it easy to swap networks, mock for tests, or add support for
 *      other chains later without touching application code.
 *
 *   2. SECRET KEY HANDLING — Keypairs are stored as base64-encoded secret keys
 *      in the `treasury.encryptedSecret` DB field. The "encrypted" prefix signals
 *      production intent: in a real deployment, AES-256-GCM encryption would wrap
 *      the base64 bytes before storage. For the MVP/devnet, base64 is sufficient.
 *
 *   3. USDC MINT RESOLUTION — The token mint address is resolved at call time:
 *      - If DEVNET_DEMO_MINT_ADDRESS env var is set → use the demo mint
 *        (created by fund-demo, owned by the treasury keypair)
 *      - Otherwise → fall back to Circle's official devnet USDC mint
 *      This allows the demo to work without any real USDC while using
 *      the same SPL transfer code path as mainnet.
 *
 *   4. TOKEN ACCOUNT CREATION — getOrCreateAssociatedTokenAccount() handles
 *      the case where the recipient doesn't have a token account yet.
 *      The treasury wallet pays the account creation fee (rent exemption ~0.002 SOL).
 *      This is why the treasury needs SOL for fees even though we're paying in USDC.
 *
 *   5. KILL SWITCH (MVP) — freezeTreasury() currently only logs and relies on
 *      DB status = FROZEN as the enforcement mechanism. In production, this would
 *      call setAuthority() to revoke mint/transfer authority on-chain, making the
 *      freeze cryptographically enforced rather than application-level enforced.
 *
 * Network configuration:
 *   - All connections use SOLANA_RPC_URL from env (loaded by server.ts dotenv)
 *   - Default: https://api.devnet.solana.com (Solana public devnet)
 *   - For local dev: http://localhost:8899 (solana-test-validator in Docker)
 *   - For mainnet: https://api.mainnet-beta.solana.com (or dedicated RPC)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  transfer,
} from '@solana/spl-token';
import { DevnetUsdcMint, DEVNET_RPC_URL, explorerTxUrl } from './constants.js';

/**
 * WalletInfo — returned by createWallet().
 * publicKey: the Solana wallet address (safe to share, goes in DB and API responses)
 * encryptedSecret: base64-encoded secret key (NEVER exposed outside the server)
 */
export type WalletInfo = {
  publicKey: string;
  encryptedSecret: string;
};

/**
 * TransferResult — returned by transferUsdc() after a successful on-chain transfer.
 * signature: the transaction signature (uniquely identifies the tx on-chain)
 * explorerUrl: direct link to view the transaction on Solana Explorer
 */
export type TransferResult = {
  signature: string;
  explorerUrl: string;
};

/**
 * TreasuryService — main class for all Solana operations.
 *
 * One instance per request (instantiated in route handlers).
 * The network parameter selects devnet vs mainnet-beta; the RPC URL
 * comes from the SOLANA_RPC_URL environment variable.
 */
export class TreasuryService {
  private connection: Connection;
  private network: 'devnet' | 'mainnet-beta';

  constructor(network: 'devnet' | 'mainnet-beta' = 'devnet') {
    this.network = network;
    // DEVNET_RPC_URL constant reads process.env['SOLANA_RPC_URL'] at import time.
    // server.ts loads dotenv/config before any imports, so this resolves correctly.
    this.connection = new Connection(DEVNET_RPC_URL, 'confirmed');
  }

  /**
   * createWallet() — generate a new Solana keypair for a treasury.
   *
   * Called once when POST /companies/:id/treasuries is called.
   * The public key becomes the treasury's on-chain address (stored as walletAddress).
   * The secret key is base64-encoded and stored as encryptedSecret (server-side only).
   *
   * In production, wrap the base64 bytes with AES-256-GCM before storing in DB.
   */
  createWallet(): WalletInfo {
    const keypair = Keypair.generate();
    return {
      publicKey: keypair.publicKey.toBase58(),
      // Base64 encode — in production, encrypt with AES-256 before storing
      encryptedSecret: Buffer.from(keypair.secretKey).toString('base64'),
    };
  }

  /**
   * restoreKeypair() — reconstruct a Keypair from stored secret.
   * Private: only used internally for signing transactions.
   */
  private restoreKeypair(encryptedSecret: string): Keypair {
    const secretKey = Buffer.from(encryptedSecret, 'base64');
    return Keypair.fromSecretKey(secretKey);
  }

  /**
   * airdropSol() — request SOL from the devnet faucet.
   *
   * Used during demo setup to fund the treasury wallet with SOL for gas fees.
   * NOT available on mainnet (airdropSol is devnet/testnet only).
   * On local test validator (Docker), there are no rate limits.
   *
   * @param solAmount — amount in SOL (default: 1 SOL)
   * @returns transaction signature
   */
  async airdropSol(walletAddress: string, solAmount: number = 1): Promise<string> {
    const publicKey = new PublicKey(walletAddress);
    const signature = await this.connection.requestAirdrop(
      publicKey,
      solAmount * LAMPORTS_PER_SOL,
    );
    const latestBlockhash = await this.connection.getLatestBlockhash();
    await this.connection.confirmTransaction({
      signature,
      ...latestBlockhash,
    });
    return signature;
  }

  /**
   * getSolBalance() — check SOL balance of a wallet.
   * Returns balance in SOL (not lamports). Used for health checks and logging.
   */
  async getSolBalance(walletAddress: string): Promise<number> {
    const publicKey = new PublicKey(walletAddress);
    const lamports = await this.connection.getBalance(publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  /**
   * getUsdcBalance() — check USDC (or demo token) balance of a wallet.
   *
   * Returns 0 if no token account exists for this wallet+mint combination.
   * Used by the dashboard to show the treasury balance in the UI.
   *
   * @param usdcMint — defaults to Circle's devnet USDC mint
   */
  async getUsdcBalance(walletAddress: string, usdcMint: PublicKey = DevnetUsdcMint): Promise<number> {
    try {
      const publicKey = new PublicKey(walletAddress);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(publicKey, {
        mint: usdcMint,
      });
      if (tokenAccounts.value.length === 0) return 0;
      const amount = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
      return amount as number;
    } catch {
      return 0;
    }
  }

  /**
   * transferUsdc() — execute an SPL token transfer from treasury to recipient.
   *
   * This is THE on-chain payment execution — called by POST /spend-requests/:id/execute
   * after a spend request is APPROVED. It produces a real, verifiable on-chain transaction.
   *
   * Steps:
   *   1. Resolve the token mint (demo mint from env, or Circle's devnet USDC)
   *   2. Restore the treasury keypair from encryptedSecret
   *   3. Get or create the sender's Associated Token Account (ATA)
   *   4. Get or create the recipient's ATA (treasury pays creation fee if needed)
   *   5. Transfer `amount` tokens (converted to micro-units: 1 USDC = 1,000,000)
   *   6. Return the tx signature + Solana Explorer URL for audit logging
   *
   * Why micro-units? SPL tokens store amounts as integers. USDC uses 6 decimal places,
   * so 1 USDC = 1,000,000 base units (like cents, but 6 digits instead of 2).
   *
   * @param fromEncryptedSecret — treasury keypair as base64 (from treasury.encryptedSecret)
   * @param toWalletAddress — recipient's Solana wallet address
   * @param amount — amount in USDC (e.g., 15.5 for 15.50 USDC)
   * @param usdcMint — optional override; if omitted, resolved from env then fallback
   */
  async transferUsdc(
    fromEncryptedSecret: string,
    toWalletAddress: string,
    amount: number,
    usdcMint?: PublicKey,
  ): Promise<TransferResult> {
    // Mint resolution order:
    //   1. Explicit usdcMint param (for programmatic overrides in tests)
    //   2. DEVNET_DEMO_MINT_ADDRESS env var (custom demo mint created by fund-demo)
    //   3. Circle's official devnet USDC mint (fallback)
    const resolvedMint = usdcMint ?? (
      process.env['DEVNET_DEMO_MINT_ADDRESS']
        ? new PublicKey(process.env['DEVNET_DEMO_MINT_ADDRESS'])
        : DevnetUsdcMint
    );

    const fromKeypair = this.restoreKeypair(fromEncryptedSecret);
    const toPublicKey = new PublicKey(toWalletAddress);

    // Get or create Associated Token Accounts (ATAs).
    // An ATA is the standard derivable token account for a wallet+mint pair.
    // If the recipient doesn't have one, the treasury creates it (and pays rent).
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      fromKeypair,       // payer (pays for account creation if needed)
      resolvedMint,
      fromKeypair.publicKey,
    );

    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      fromKeypair,       // treasury pays recipient's account creation too
      resolvedMint,
      toPublicKey,
    );

    // Convert human-readable amount to base units (6 decimal places like USDC)
    // Math.round() handles floating-point imprecision (e.g., 15.5 * 1_000_000 = 15499999.999...)
    const amountInMicroUsdc = Math.round(amount * 1_000_000);

    const signature = await transfer(
      this.connection,
      fromKeypair,                  // transaction fee payer
      fromTokenAccount.address,     // source token account
      toTokenAccount.address,       // destination token account
      fromKeypair.publicKey,        // transfer authority (owner of source account)
      amountInMicroUsdc,
    );

    return {
      signature,
      explorerUrl: explorerTxUrl(signature, this.network),
    };
  }

  /**
   * freezeTreasury() — emergency stop for on-chain funds.
   *
   * MVP implementation: logs the freeze event.
   * DB enforcement: treasury.status = 'FROZEN' blocks further execute() calls
   * in spend-requests.ts (checked before calling transferUsdc).
   *
   * Production implementation (TODO for mainnet):
   *   - Call setAuthority() to revoke mint authority → no new tokens can be minted
   *   - Call setAuthority() to revoke transfer authority → existing tokens can't move
   *   - This makes the freeze cryptographically enforced, not just application-level
   *
   * The kill switch flow:
   *   POST /agents/:id/kill-switch { active: true }
   *     → sets agent.killSwitchActive = true (blocks policy engine, Rule 1)
   *     → sets treasury.status = 'FROZEN' (blocks execute route)
   *     → calls freezeTreasury() (currently logs; production: revokes on-chain authority)
   */
  async freezeTreasury(walletAddress: string): Promise<void> {
    // MVP: DB status enforcement is the primary mechanism
    // Production: use setAuthority() here to revoke on-chain authority
    console.log(`Treasury ${walletAddress} marked as frozen`);
  }

  /**
   * confirmTransaction() — wait for a transaction to finalize and verify success.
   *
   * Used after airdrop and token operations to ensure they landed on-chain
   * before proceeding. Returns false on timeout or error rather than throwing.
   */
  async confirmTransaction(signature: string): Promise<boolean> {
    try {
      const latestBlockhash = await this.connection.getLatestBlockhash();
      const result = await this.connection.confirmTransaction({
        signature,
        ...latestBlockhash,
      });
      return !result.value.err;
    } catch {
      return false;
    }
  }
}
