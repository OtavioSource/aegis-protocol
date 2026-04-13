/**
 * @file treasury.ts
 * @package @aegis/solana
 *
 * ═══════════════════════════════════════════════════════════════
 *  TREASURY SERVICE — SOLANA WALLET AND TOKEN-2022 OPERATIONS
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
 *   3. TOKEN-2022 + PERMANENT DELEGATE — The demo mint created by fund-demo is a
 *      Token-2022 mint with the PermanentDelegate extension. This means:
 *      - Transfers use `transferChecked` (Token-2022 requirement for extension mints)
 *      - The program ID for all operations is TOKEN_2022_PROGRAM_ID (not TOKEN_PROGRAM_ID)
 *      - Kill switch calls `freezeTreasury()` which uses the Permanent Delegate to
 *        sweep the frozen treasury's entire token balance to a quarantine wallet —
 *        making the freeze cryptographically enforced, not just a DB flag.
 *
 *   4. TOKEN PROGRAM DETECTION — The correct program is resolved at call time:
 *      - Custom demo mint (DEVNET_DEMO_MINT_ADDRESS) → TOKEN_2022_PROGRAM_ID
 *      - Circle's official devnet USDC (DevnetUsdcMint) → TOKEN_PROGRAM_ID (standard SPL)
 *      This allows graceful fallback if the demo mint isn't configured.
 *
 *   5. USDC MINT RESOLUTION — The token mint address is resolved at call time:
 *      - If DEVNET_DEMO_MINT_ADDRESS env var is set → use the demo mint (Token-2022)
 *      - Otherwise → fall back to Circle's official devnet USDC mint (standard SPL)
 *
 *   6. TOKEN ACCOUNT CREATION — getOrCreateAssociatedTokenAccount() handles
 *      the case where the recipient doesn't have a token account yet.
 *      The treasury wallet pays the account creation fee (rent exemption ~0.002 SOL).
 *      This is why the treasury needs SOL for fees even though we're paying in USDC.
 *
 *   7. KILL SWITCH — freezeTreasury() uses the Permanent Delegate (AEGIS_DELEGATE_SECRET)
 *      to sweep ALL tokens from the frozen treasury to a quarantine wallet via an
 *      on-chain transferChecked instruction. This creates a verifiable on-chain tx
 *      that proves the freeze is enforced at the blockchain level.
 *      Requires: AEGIS_DELEGATE_SECRET env var set correctly.
 *      Fallback: if env vars not set, logs a warning and relies on DB enforcement.
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
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  transfer,
  transferChecked,
} from '@solana/spl-token';
import { DevnetUsdcMint, DEVNET_RPC_URL, explorerTxUrl } from './constants.js';
import type {
  SettlementAdapter,
  AdapterTransferParams,
  AdapterTransferResult,
} from '@aegis/shared';

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
export class TreasuryService implements SettlementAdapter {
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
   * resolveTokenProgram() — determine which SPL token program to use for a given mint.
   *
   * Our custom demo mint (created by fund-demo) is a Token-2022 mint.
   * Circle's official devnet USDC is a standard SPL mint.
   * We detect which program to use by comparing against DevnetUsdcMint —
   * any mint that is NOT Circle's USDC is assumed to be our Token-2022 demo mint.
   */
  private resolveTokenProgram(mint: PublicKey): PublicKey {
    return mint.toBase58() === DevnetUsdcMint.toBase58()
      ? TOKEN_PROGRAM_ID
      : TOKEN_2022_PROGRAM_ID;
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
   * getUsdcBalance() — check token balance of a wallet.
   *
   * Tries standard SPL first (covers Circle's devnet USDC).
   * If no balance found, queries Token-2022 program and filters by mint
   * (covers our custom Token-2022 demo mint).
   *
   * Returns 0 if no token account exists for this wallet+mint combination.
   *
   * @param usdcMint — defaults to Circle's devnet USDC mint
   */
  async getUsdcBalance(walletAddress: string, usdcMint: PublicKey = DevnetUsdcMint): Promise<number> {
    try {
      const publicKey = new PublicKey(walletAddress);

      // Try standard SPL Token program first (Circle USDC and standard tokens)
      let tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(publicKey, {
        mint: usdcMint,
      });

      // If not found under standard SPL, try Token-2022 program and filter by mint.
      // getParsedTokenAccountsByOwner with { mint } only searches TOKEN_PROGRAM_ID;
      // Token-2022 accounts require explicit programId filter.
      if (tokenAccounts.value.length === 0) {
        const t22Accounts = await this.connection.getParsedTokenAccountsByOwner(publicKey, {
          programId: TOKEN_2022_PROGRAM_ID,
        });
        tokenAccounts.value = t22Accounts.value.filter(
          (acc) => acc.account.data.parsed.info.mint === usdcMint.toBase58(),
        );
      }

      if (tokenAccounts.value.length === 0) return 0;
      const amount = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
      return amount as number;
    } catch {
      return 0;
    }
  }

  /**
   * transferUsdc() — execute an SPL (or Token-2022) token transfer from treasury to recipient.
   *
   * This is THE on-chain payment execution — called by POST /spend-requests/:id/execute
   * after a spend request is APPROVED. It produces a real, verifiable on-chain transaction.
   *
   * For Token-2022 mints (our demo mint), uses `transferChecked` with TOKEN_2022_PROGRAM_ID.
   * For standard SPL mints (Circle's devnet USDC), uses standard `transfer`.
   *
   * Steps:
   *   1. Resolve the token mint (demo mint from env, or Circle's devnet USDC)
   *   2. Detect the token program (Token-2022 vs standard SPL)
   *   3. Restore the treasury keypair from encryptedSecret
   *   4. Get or create the sender's Associated Token Account (ATA)
   *   5. Get or create the recipient's ATA (treasury pays creation fee if needed)
   *   6. Transfer `amount` tokens using the correct program and instruction
   *   7. Return the tx signature + Solana Explorer URL for audit logging
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
    //   2. DEVNET_DEMO_MINT_ADDRESS env var (custom Token-2022 demo mint)
    //   3. Circle's official devnet USDC mint (fallback, standard SPL)
    const resolvedMint = usdcMint ?? (
      process.env['DEVNET_DEMO_MINT_ADDRESS']
        ? new PublicKey(process.env['DEVNET_DEMO_MINT_ADDRESS'])
        : DevnetUsdcMint
    );

    // Determine which token program to use based on the mint.
    // Token-2022 mints require a different program ID for all operations.
    const tokenProgram = this.resolveTokenProgram(resolvedMint);
    const isToken2022 = tokenProgram === TOKEN_2022_PROGRAM_ID;

    const fromKeypair = this.restoreKeypair(fromEncryptedSecret);
    const toPublicKey = new PublicKey(toWalletAddress);

    // Get or create Associated Token Accounts (ATAs).
    // Pass the correct tokenProgram so the ATA address is derived consistently.
    // An ATA derived from TOKEN_2022_PROGRAM_ID has a different address than
    // one derived from TOKEN_PROGRAM_ID for the same wallet+mint pair.
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      fromKeypair,              // payer (pays for account creation if needed)
      resolvedMint,
      fromKeypair.publicKey,
      false,
      undefined,
      undefined,
      tokenProgram,
    );

    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      fromKeypair,              // treasury pays recipient's account creation too
      resolvedMint,
      toPublicKey,
      false,
      undefined,
      undefined,
      tokenProgram,
    );

    // Convert human-readable amount to base units (6 decimal places like USDC).
    // Math.round() handles floating-point imprecision (e.g., 15.5 * 1_000_000 = 15499999.999...)
    const amountInMicroUsdc = Math.round(amount * 1_000_000);

    let signature: string;
    if (isToken2022) {
      // Token-2022 requires transferChecked — it includes the mint address and decimals
      // as explicit parameters, providing an extra safety check against mint confusion.
      // This is also required for mints with transfer hooks or other extensions.
      signature = await transferChecked(
        this.connection,
        fromKeypair,                  // transaction fee payer
        fromTokenAccount.address,     // source token account
        resolvedMint,                 // mint (required by transferChecked)
        toTokenAccount.address,       // destination token account
        fromKeypair,                  // transfer authority (owner of source account)
        amountInMicroUsdc,
        6,                            // decimals (must match the mint)
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
    } else {
      // Standard SPL token transfer
      signature = await transfer(
        this.connection,
        fromKeypair,                  // transaction fee payer
        fromTokenAccount.address,     // source token account
        toTokenAccount.address,       // destination token account
        fromKeypair.publicKey,        // transfer authority (owner of source account)
        amountInMicroUsdc,
      );
    }

    return {
      signature,
      explorerUrl: explorerTxUrl(signature, this.network),
    };
  }

  /**
   * freezeTreasury() — emergency on-chain fund sweep via Permanent Delegate.
   *
   * When the kill switch is activated, this method uses the Aegis Permanent Delegate
   * (AEGIS_DELEGATE_SECRET) to sweep ALL tokens from the frozen treasury wallet to
   * a quarantine account. This produces a real, verifiable on-chain transaction,
   * making the freeze cryptographically enforced — not just a DB flag.
   *
   * The Permanent Delegate is a Token-2022 mint extension that grants a designated
   * keypair the authority to transfer tokens from ANY holder of that mint without
   * their signature. Aegis holds this authority as the control plane operator.
   *
   * Requirements:
   *   - AEGIS_DELEGATE_SECRET env var: base64-encoded Permanent Delegate keypair
   *   - DEVNET_DEMO_MINT_ADDRESS env var: the Token-2022 mint address
   *   - Quarantine destination: AEGIS_QUARANTINE_ADDRESS env var (optional —
   *     defaults to the delegate's own wallet if not set)
   *
   * Fallback: if env vars are not configured, logs a warning and returns gracefully.
   * DB enforcement (treasury.status = FROZEN) remains active regardless.
   *
   * Kill switch flow:
   *   POST /agents/:id/kill-switch { active: true }
   *     → sets agent.killSwitchActive = true (blocks policy engine, Rule 1)
   *     → sets treasury.status = 'FROZEN' (blocks execute route)
   *     → calls freezeTreasury() → Permanent Delegate sweeps tokens on-chain
   *
   * @param walletAddress — the treasury wallet to freeze (public address)
   */
  async freezeTreasury(walletAddress: string): Promise<void> {
    const delegateSecret = process.env['AEGIS_DELEGATE_SECRET'];
    const mintEnvAddress = process.env['DEVNET_DEMO_MINT_ADDRESS'];

    if (!delegateSecret || !mintEnvAddress) {
      // Graceful fallback: DB-level enforcement via treasury.status = FROZEN is still active.
      // The kill switch blocks all future execute() calls regardless of on-chain state.
      console.log(
        `[aegis:freeze] Treasury ${walletAddress} frozen (DB-level enforcement only). ` +
        `Set AEGIS_DELEGATE_SECRET + DEVNET_DEMO_MINT_ADDRESS for on-chain sweep.`,
      );
      return;
    }

    const delegateKeypair = Keypair.fromSecretKey(Buffer.from(delegateSecret, 'base64'));
    const mint = new PublicKey(mintEnvAddress);
    const walletPubkey = new PublicKey(walletAddress);

    // Quarantine destination: where swept tokens go.
    // Use a dedicated quarantine address if configured, otherwise the delegate's own wallet.
    const quarantineAddress = process.env['AEGIS_QUARANTINE_ADDRESS']
      ? new PublicKey(process.env['AEGIS_QUARANTINE_ADDRESS'])
      : delegateKeypair.publicKey;

    // Ensure the delegate has SOL for transaction fees
    const delegateBalance = await this.connection.getBalance(delegateKeypair.publicKey);
    if (delegateBalance < 0.01 * LAMPORTS_PER_SOL) {
      console.warn(
        `[aegis:freeze] Permanent Delegate wallet has low SOL balance (${delegateBalance} lamports). ` +
        `On-chain freeze may fail. Fund ${delegateKeypair.publicKey.toBase58()} with devnet SOL.`,
      );
    }

    // Get the frozen treasury's Token-2022 ATA.
    // We use getOrCreateAssociatedTokenAccount so we get the account info (including balance)
    // without failing if the account happens to not exist yet.
    let frozenTokenAccount: Awaited<ReturnType<typeof getOrCreateAssociatedTokenAccount>>;
    try {
      frozenTokenAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        delegateKeypair,      // delegate pays for account creation if needed
        mint,
        walletPubkey,
        false,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
    } catch (err) {
      console.log(`[aegis:freeze] Could not find token account for ${walletAddress}:`, err);
      return;
    }

    const balance = Number(frozenTokenAccount.amount);
    if (balance === 0) {
      console.log(`[aegis:freeze] Treasury ${walletAddress} has zero token balance — nothing to sweep.`);
      return;
    }

    // Ensure the quarantine wallet has a Token-2022 ATA to receive the tokens.
    // The delegate pays for its creation if needed.
    const quarantineTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      delegateKeypair,
      mint,
      quarantineAddress,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    // Execute the Permanent Delegate sweep.
    // Key: the `owner` parameter is `delegateKeypair` (not the treasury's keypair).
    // The Token-2022 program recognizes that delegateKeypair is the PermanentDelegate
    // of this mint and allows the transfer regardless of who owns the source account.
    const signature = await transferChecked(
      this.connection,
      delegateKeypair,                  // payer (delegate pays gas)
      frozenTokenAccount.address,       // source: frozen treasury's token account
      mint,                             // the Token-2022 mint
      quarantineTokenAccount.address,   // destination: quarantine wallet
      delegateKeypair,                  // authority = Permanent Delegate (not treasury owner!)
      balance,                          // sweep the entire balance
      6,                                // decimals (must match mint)
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    const humanBalance = balance / 1_000_000;
    const explorerLink = explorerTxUrl(signature, this.network);
    console.log(
      `[aegis:freeze] ✅ On-chain freeze executed.\n` +
      `  Swept: ${humanBalance} tokens\n` +
      `  From:  ${walletAddress}\n` +
      `  To:    ${quarantineAddress.toBase58()} (quarantine)\n` +
      `  Tx:    ${explorerLink}`,
    );
  }

  // ─── SettlementAdapter interface methods ──────────────────────────────────
  // These are the chain-agnostic adapter methods used when the API layer
  // treats TreasuryService as a SettlementAdapter (e.g., to support
  // adapter selection based on treasury.network for future Stellar support).

  /**
   * transfer() — SettlementAdapter wrapper around transferUsdc().
   * Maps AdapterTransferParams to the existing transferUsdc() signature.
   */
  async transfer(params: AdapterTransferParams): Promise<AdapterTransferResult> {
    return this.transferUsdc(params.fromEncryptedSecret, params.toPublicKey, params.amount);
  }

  /**
   * freeze() — SettlementAdapter wrapper around freezeTreasury().
   */
  async freeze(walletAddress: string): Promise<void> {
    return this.freezeTreasury(walletAddress);
  }

  /**
   * getBalance() — SettlementAdapter wrapper around getUsdcBalance().
   */
  async getBalance(walletAddress: string): Promise<number> {
    return this.getUsdcBalance(walletAddress);
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
