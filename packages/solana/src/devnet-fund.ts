/**
 * @file devnet-fund.ts
 * @package @aegis/solana
 *
 * ═══════════════════════════════════════════════════════════════
 *  DEVNET FUNDING UTILITIES — DEMO SETUP ONLY
 * ═══════════════════════════════════════════════════════════════
 *
 * ⚠️  NOT FOR PRODUCTION USE. This file creates custom Token-2022 mints
 * and mints tokens out of thin air — only valid on devnet/localnet.
 *
 * Purpose:
 *   Enables the demo to work without real USDC or a live faucet.
 *   Called via POST /companies/:companyId/treasuries/:id/fund-demo.
 *
 * Why Token-2022 instead of standard SPL?
 *   Token-2022 (the new SPL token standard) enables the PermanentDelegate
 *   extension, which gives Aegis Protocol an on-chain kill switch:
 *   the delegate keypair can sweep tokens from any holder's account
 *   without their signature, making treasury freezes cryptographically
 *   enforced rather than just application-level DB flags.
 *
 *   This is a core differentiator vs. generic SPL token implementations.
 *
 * Token-2022 mint creation sequence (order is critical):
 *   1. SystemProgram.createAccount — allocate account space for the mint
 *   2. createInitializePermanentDelegateInstruction — MUST precede initMint
 *   3. createInitializeMintInstruction (TOKEN_2022_PROGRAM_ID) — finalize mint
 *   All three must be in the same transaction.
 *
 * Permanent Delegate:
 *   Resolved in priority order:
 *     1. explicit `permanentDelegatePublicKey` param
 *     2. AEGIS_DELEGATE_SECRET env var → derive pubkey
 *     3. fallback to mint authority (self-delegate — works but reduces separation)
 *   Store the delegate keypair as AEGIS_DELEGATE_SECRET in .env.
 *   The delegate's pubkey is returned in DevnetFundResult.permanentDelegateAddress.
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
 *   1. Add AEGIS_DELEGATE_SECRET to .env (generate with generateMintAuthority())
 *   2. POST /companies/:id/treasuries/:id/fund-demo → calls fundTreasuryForDemo()
 *   3. Copy returned mintAddress → set DEVNET_DEMO_MINT_ADDRESS in .env
 *   4. Restart API server so transferUsdc() picks up the new mint address
 *   5. All spend request executions now use this Token-2022 mint
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializePermanentDelegateInstruction,
  createInitializeMintInstruction,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
} from '@solana/spl-token';
import { explorerTxUrl } from './constants.js';

/**
 * DevnetFundResult — returned by fundTreasuryForDemo() after successful funding.
 */
export type DevnetFundResult = {
  /** The Token-2022 mint address — save as DEVNET_DEMO_MINT_ADDRESS in .env */
  mintAddress: string;
  /** The Permanent Delegate pubkey — this keypair can sweep tokens on-chain (kill switch) */
  permanentDelegateAddress: string;
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
 * fundTreasuryForDemo() — fund a devnet treasury with Token-2022 test tokens.
 *
 * Full funding flow:
 *   1. Check treasury SOL balance — airdrop 1 SOL if below 0.1 SOL threshold
 *   2. Resolve mint authority keypair (explicit secret or treasury keypair)
 *   3. Resolve Permanent Delegate pubkey (explicit param → env var → mint authority)
 *   4. Create Token-2022 mint with PermanentDelegate extension (or verify existing)
 *   5. Get or create the treasury's Associated Token Account (Token-2022 ATA)
 *   6. Mint `amount` tokens to the treasury's token account
 *
 * @param treasuryWalletAddress — the treasury's public Solana address
 * @param treasuryEncryptedSecret — base64-encoded keypair secret (from DB)
 * @param amount — how many tokens to mint (default: 1000; in human units, not micro-units)
 * @param mintAuthoritySecret — optional: base64-encoded keypair for a persistent mint authority
 * @param existingMintAddress — optional: reuse an existing Token-2022 mint instead of creating one
 * @param permanentDelegatePublicKey — optional: explicit pubkey for the Permanent Delegate
 */
export async function fundTreasuryForDemo(params: {
  treasuryWalletAddress: string;
  treasuryEncryptedSecret: string;
  amount?: number;
  mintAuthoritySecret?: string;
  existingMintAddress?: string;
  permanentDelegatePublicKey?: string;
}): Promise<DevnetFundResult> {
  const {
    treasuryEncryptedSecret,
    amount = 1000,
    mintAuthoritySecret,
    existingMintAddress,
    permanentDelegatePublicKey,
  } = params;

  // Read RPC URL inline (not from imported constant) to ensure dotenv has loaded
  const rpcUrl = process.env['SOLANA_RPC_URL'] ?? 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const treasuryKeypair = Keypair.fromSecretKey(Buffer.from(treasuryEncryptedSecret, 'base64'));

  // ─── Step 1: Airdrop SOL if needed ───────────────────────────────────────
  // The treasury needs SOL to pay for:
  //   - Transaction fees (~0.000005 SOL per tx)
  //   - Token account creation rent (~0.002 SOL per account, one-time)
  //   - Token-2022 mint account rent (slightly larger than standard SPL)
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

  // ─── Step 3: Resolve Permanent Delegate pubkey ───────────────────────────
  // The Permanent Delegate is the keypair that can sweep tokens from any holder
  // of this mint — used by freezeTreasury() to enforce the kill switch on-chain.
  //
  // Resolution priority:
  //   1. explicit permanentDelegatePublicKey param (programmatic override)
  //   2. AEGIS_DELEGATE_SECRET env var → derive the public key
  //   3. fallback: mint authority as self-delegate (works for demo, not ideal for prod)
  let delegatePubkey: PublicKey;
  if (permanentDelegatePublicKey) {
    delegatePubkey = new PublicKey(permanentDelegatePublicKey);
  } else if (process.env['AEGIS_DELEGATE_SECRET']) {
    delegatePubkey = Keypair.fromSecretKey(
      Buffer.from(process.env['AEGIS_DELEGATE_SECRET'], 'base64'),
    ).publicKey;
  } else {
    // Self-delegate: mint authority doubles as the Permanent Delegate.
    // Functional for demo but means losing the separation of concerns.
    delegatePubkey = mintAuthorityKeypair.publicKey;
  }

  // ─── Step 4: Create or verify the Token-2022 mint ────────────────────────
  // Token-2022 mints with extensions require a custom account creation flow.
  // Unlike standard SPL's createMint() helper, we must build the transaction
  // manually so we can initialize the PermanentDelegate extension BEFORE
  // the mint itself (Token-2022 requires extensions initialized first).
  //
  // If existingMintAddress is set (DEVNET_DEMO_MINT_ADDRESS env var),
  // verify the mint still exists on-chain and reuse it for idempotency.
  let mintAddress: PublicKey;
  if (existingMintAddress) {
    mintAddress = new PublicKey(existingMintAddress);
    // Verify with TOKEN_2022_PROGRAM_ID — standard getMint() would fail on Token-2022 accounts
    await getMint(connection, mintAddress, undefined, TOKEN_2022_PROGRAM_ID);
  } else {
    // Generate a fresh keypair for the mint account itself
    // (separate from the mint authority — different concerns)
    const mintKeypair = Keypair.generate();

    // getMintLen() calculates the exact byte size needed for this extension set
    const extensions = [ExtensionType.PermanentDelegate];
    const mintLen = getMintLen(extensions);
    const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

    // Instruction 1: allocate the mint account with the Token-2022 program as owner
    const createAccountIx = SystemProgram.createAccount({
      fromPubkey: mintAuthorityKeypair.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    });

    // Instruction 2: initialize PermanentDelegate extension BEFORE the mint
    // This order is required by the Token-2022 spec — extension metadata must
    // precede the base mint data in the account layout.
    const initDelegateIx = createInitializePermanentDelegateInstruction(
      mintKeypair.publicKey,
      delegatePubkey,      // the keypair that can sweep tokens without owner sig
      TOKEN_2022_PROGRAM_ID,
    );

    // Instruction 3: initialize the mint itself (6 decimals = USDC precision)
    const initMintIx = createInitializeMintInstruction(
      mintKeypair.publicKey,
      6,                                // decimals (USDC standard = 6)
      mintAuthorityKeypair.publicKey,   // can mint more tokens
      null,                             // no freeze authority on individual accounts
      TOKEN_2022_PROGRAM_ID,
    );

    // Send all three instructions atomically — partial execution would leave
    // the mint in an invalid state
    const tx = new Transaction().add(createAccountIx, initDelegateIx, initMintIx);
    await sendAndConfirmTransaction(connection, tx, [mintAuthorityKeypair, mintKeypair]);
    mintAddress = mintKeypair.publicKey;
  }

  // ─── Step 5: Get or create treasury's Token-2022 ATA ─────────────────────
  // The Associated Token Account (ATA) is the standard derivable token account.
  // Pass TOKEN_2022_PROGRAM_ID so the ATA is derived from the Token-2022 program
  // rather than the standard SPL program (different program → different address).
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    treasuryKeypair,              // payer for account creation
    mintAddress,
    treasuryKeypair.publicKey,
    false,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,        // critical: use Token-2022 program for ATA derivation
  );

  // ─── Step 6: Mint tokens to the treasury ─────────────────────────────────
  // Convert human-readable amount to base units (6 decimal places like USDC).
  // 1000 tokens = 1,000,000,000 base units.
  const amountInSmallestUnit = Math.round(amount * 1_000_000);
  const mintSig = await mintTo(
    connection,
    mintAuthorityKeypair,
    mintAddress,
    tokenAccount.address,
    mintAuthorityKeypair,
    amountInSmallestUnit,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID,        // must match the program used to create the mint
  );

  return {
    mintAddress: mintAddress.toBase58(),
    permanentDelegateAddress: delegatePubkey.toBase58(),
    solSignature: airdropSig,
    mintSignature: mintSig,
    balance: amount,
    explorerUrl: explorerTxUrl(mintSig, 'devnet'),
  };
}

/**
 * generateMintAuthority() — create a new keypair to use as a persistent mint authority
 * or as the Aegis Permanent Delegate.
 *
 * Run this once during initial demo setup. Store the output:
 *   - secretBase64 → DEVNET_DEMO_MINT_AUTHORITY_SECRET or AEGIS_DELEGATE_SECRET in .env
 *   - publicKey → for reference/documentation only
 *
 * The SAME keypair can serve as both mint authority and permanent delegate,
 * or you can generate two separate keypairs for better separation of concerns.
 *
 * @example
 *   import { generateMintAuthority } from '@aegis/solana';
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
