/**
 * @file devnet-fund.ts
 * @package @command-rail/solana
 *
 * ═══════════════════════════════════════════════════════════════
 *  DEVNET FUNDING UTILITIES — DEMO SETUP ONLY
 * ═══════════════════════════════════════════════════════════════
 *
 * ⚠️  NOT FOR PRODUCTION USE. This file creates custom SPL token mints
 * and mints tokens out of thin air — only valid on devnet/localnet.
 *
 * Purpose:
 *   Enables the demo to work without real USDC or a live faucet.
 *   Called via POST /companies/:companyId/treasuries/:id/fund-demo.
 *
 * Why a custom mint instead of Circle's devnet USDC?
 *   Circle's devnet USDC faucet is rate-limited and unreliable. All public
 *   devnet faucets were rate-limited (429) during development. Running a
 *   local Solana test validator (Docker: solanalabs/solana:stable) combined
 *   with a custom mint gives unlimited, offline-capable funding.
 *   The SPL transfer code path is identical regardless of which mint is used.
 *
 * Mint persistence strategy:
 *   Each call to fundTreasuryForDemo() can create a new mint OR reuse one.
 *   For demo repeatability, DEVNET_DEMO_MINT_ADDRESS should be set in .env
 *   after the first call. Without it, each call creates a new mint that the
 *   treasury's existing token accounts don't recognize → transfer failures.
 *
 * Why does env var use process.env['SOLANA_RPC_URL'] inline (not imported constant)?
 *   The DEVNET_RPC_URL constant in constants.ts reads process.env at module
 *   import time. If this file is imported before dotenv/config runs (e.g., in
 *   a script), the constant captures the wrong value. Reading inline at
 *   call time ensures the env var is always fresh and correctly loaded.
 *
 * Usage flow:
 *   1. POST /companies/:id/treasuries/:id/fund-demo → calls fundTreasuryForDemo()
 *   2. Copy returned mintAddress → set DEVNET_DEMO_MINT_ADDRESS in .env
 *   3. Restart API server so transferUsdc() picks up the new mint address
 *   4. All spend request executions now use this mint
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
} from '@solana/spl-token';
import { explorerTxUrl } from './constants.js';

/**
 * DevnetFundResult — returned by fundTreasuryForDemo() after successful funding.
 */
export type DevnetFundResult = {
  /** The SPL token mint address — save as DEVNET_DEMO_MINT_ADDRESS in .env */
  mintAddress: string;
  /** SOL airdrop tx signature (or 'skipped-sufficient-balance' if already funded) */
  solSignature: string;
  /** Token mint tx signature — verifiable on Solana Explorer */
  mintSignature: string;
  /** How many tokens were minted (in human-readable units) */
  balance: number;
  /** Direct Solana Explorer link for the mint transaction */
  explorerUrl: string;
};

/**
 * fundTreasuryForDemo() — fund a devnet treasury with test tokens.
 *
 * Full funding flow:
 *   1. Check treasury SOL balance — airdrop 1 SOL if below 0.1 SOL threshold
 *      (SOL is needed for transaction fees and token account rent)
 *   2. If mintAuthoritySecret is provided, use that keypair as mint authority.
 *      Otherwise the treasury keypair is its own mint authority.
 *   3. If existingMintAddress is provided, verify and reuse that mint.
 *      Otherwise create a fresh SPL mint with 6 decimals (matching USDC).
 *   4. Get or create the treasury's Associated Token Account for this mint
 *   5. Mint `amount` tokens to the treasury's token account
 *
 * @param treasuryWalletAddress — the treasury's public Solana address
 * @param treasuryEncryptedSecret — base64-encoded keypair secret (from DB)
 * @param amount — how many tokens to mint (default: 1000; in human units, not micro-units)
 * @param mintAuthoritySecret — optional: base64-encoded keypair for a persistent mint authority
 * @param existingMintAddress — optional: reuse an existing mint instead of creating a new one
 */
export async function fundTreasuryForDemo(params: {
  treasuryWalletAddress: string;
  treasuryEncryptedSecret: string;
  amount?: number;
  mintAuthoritySecret?: string;
  existingMintAddress?: string;
}): Promise<DevnetFundResult> {
  const {
    treasuryEncryptedSecret,
    amount = 1000,
    mintAuthoritySecret,
    existingMintAddress,
  } = params;

  // Read RPC URL inline (not from imported constant) to ensure dotenv has loaded
  const rpcUrl = process.env['SOLANA_RPC_URL'] ?? 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const treasuryKeypair = Keypair.fromSecretKey(Buffer.from(treasuryEncryptedSecret, 'base64'));

  // ─── Step 1: Airdrop SOL if needed ───────────────────────────────────────
  // The treasury needs SOL to pay for:
  //   - Transaction fees (~0.000005 SOL per tx)
  //   - Token account creation rent (~0.002 SOL per account, one-time)
  // We only airdrop if balance is low — avoids wasting the local validator's
  // airdrop capacity and keeps the funding idempotent.
  const currentBalance = await connection.getBalance(treasuryKeypair.publicKey);
  let airdropSig = 'skipped-sufficient-balance';
  if (currentBalance < 0.1 * LAMPORTS_PER_SOL) {
    airdropSig = await connection.requestAirdrop(
      treasuryKeypair.publicKey,
      1 * LAMPORTS_PER_SOL,
    );
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: airdropSig, ...latestBlockhash });
  }

  // ─── Step 2: Determine mint authority keypair ────────────────────────────
  // If a separate mint authority is provided (a persistent keypair stored in env),
  // that authority controls the mint. Otherwise the treasury is self-authorizing.
  //
  // Using a separate mint authority is useful for production-style demos where
  // multiple treasuries need to be funded from the same shared mint.
  const mintAuthorityKeypair = mintAuthoritySecret
    ? Keypair.fromSecretKey(Buffer.from(mintAuthoritySecret, 'base64'))
    : treasuryKeypair;

  // If the mint authority is a separate account, ensure it has SOL for fees
  if (mintAuthoritySecret) {
    const balance = await connection.getBalance(mintAuthorityKeypair.publicKey);
    if (balance < 0.1 * LAMPORTS_PER_SOL) {
      try {
        const sig = await connection.requestAirdrop(
          mintAuthorityKeypair.publicKey,
          1 * LAMPORTS_PER_SOL,
        );
        const bh = await connection.getLatestBlockhash();
        await connection.confirmTransaction({ signature: sig, ...bh });
      } catch {
        // If airdrop fails for authority, treasury may cover fees — continue anyway
      }
    }
  }

  // ─── Step 3: Create or verify the token mint ─────────────────────────────
  // If existingMintAddress is set (from DEVNET_DEMO_MINT_ADDRESS env var),
  // verify the mint still exists on-chain and reuse it. This keeps token
  // accounts consistent across multiple fund-demo calls.
  //
  // If no mint exists, create one with 6 decimal places — matching USDC's
  // precision so the amounts shown in the dashboard are human-readable.
  let mintAddress: PublicKey;
  if (existingMintAddress) {
    mintAddress = new PublicKey(existingMintAddress);
    await getMint(connection, mintAddress); // Throws if mint doesn't exist
  } else {
    // New mint: 6 decimals, no freeze authority (tokens can't be frozen by mint)
    mintAddress = await createMint(
      connection,
      mintAuthorityKeypair,              // payer for the createMint transaction
      mintAuthorityKeypair.publicKey,    // mint authority (can mint more tokens)
      null,                              // no freeze authority
      6,                                 // 6 decimal places (USDC standard)
    );
  }

  // ─── Step 4: Get or create treasury's token account for this mint ────────
  // An Associated Token Account (ATA) is the standard derivable token account.
  // This is where the minted tokens will land. Created if it doesn't exist yet.
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    treasuryKeypair,          // payer for account creation
    mintAddress,
    treasuryKeypair.publicKey,
  );

  // ─── Step 5: Mint tokens to the treasury ─────────────────────────────────
  // Convert human-readable amount to the SPL base unit (micro-units).
  // 1000 tokens with 6 decimals = 1,000,000,000 base units.
  const amountInSmallestUnit = Math.round(amount * 1_000_000);
  const mintSig = await mintTo(
    connection,
    mintAuthorityKeypair,       // payer
    mintAddress,                // which token to mint
    tokenAccount.address,       // where to mint them
    mintAuthorityKeypair,       // authority that can sign the mint instruction
    amountInSmallestUnit,
  );

  return {
    mintAddress: mintAddress.toBase58(),
    solSignature: airdropSig,
    mintSignature: mintSig,
    balance: amount,
    explorerUrl: explorerTxUrl(mintSig, 'devnet'),
  };
}

/**
 * generateMintAuthority() — create a new keypair to use as a persistent mint authority.
 *
 * Run this once during initial demo setup. Store the output:
 *   - secretBase64 → DEVNET_DEMO_MINT_AUTHORITY_SECRET in .env (keep secret)
 *   - publicKey → for reference/documentation only
 *
 * Having a persistent mint authority allows multiple treasuries to be funded
 * from the same mint without re-creating it each time.
 *
 * @example
 *   import { generateMintAuthority } from '@command-rail/solana';
 *   const auth = generateMintAuthority();
 *   console.log('Public:', auth.publicKey);
 *   console.log('Secret (save to .env):', auth.secretBase64);
 */
export function generateMintAuthority(): { publicKey: string; secretBase64: string } {
  const keypair = Keypair.generate();
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretBase64: Buffer.from(keypair.secretKey).toString('base64'),
  };
}
