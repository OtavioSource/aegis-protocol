/**
 * Devnet-only utilities for funding treasury wallets with test tokens.
 * NOT for production use — this creates custom SPL tokens for demo purposes.
 */
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
} from '@solana/spl-token';
import { explorerTxUrl } from './constants.js';

export type DevnetFundResult = {
  mintAddress: string;
  solSignature: string;
  mintSignature: string;
  balance: number;
  explorerUrl: string;
};

/**
 * Fund a treasury wallet with demo tokens on devnet.
 *
 * Flow:
 * 1. Airdrop SOL to the treasury wallet (for tx fees)
 * 2. If a mint authority secret is provided, use that mint to mint tokens
 * 3. Otherwise, create a fresh one-time mint using the treasury keypair
 *
 * For production demos, pre-create a persistent mint and pass its authority secret.
 */
export async function fundTreasuryForDemo(params: {
  treasuryWalletAddress: string;
  treasuryEncryptedSecret: string;
  amount?: number;
  /** Base64-encoded secret key for the mint authority. If omitted, treasury creates its own mint. */
  mintAuthoritySecret?: string;
  /** Existing mint address to use. If omitted with mintAuthoritySecret, creates a new mint. */
  existingMintAddress?: string;
}): Promise<DevnetFundResult> {
  const {
    treasuryEncryptedSecret,
    amount = 1000,
    mintAuthoritySecret,
    existingMintAddress,
  } = params;

  const rpcUrl = process.env['SOLANA_RPC_URL'] ?? 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const treasuryKeypair = Keypair.fromSecretKey(Buffer.from(treasuryEncryptedSecret, 'base64'));

  // 1. Airdrop SOL to treasury if balance is below 0.1 SOL
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

  // 2. Determine mint authority keypair
  const mintAuthorityKeypair = mintAuthoritySecret
    ? Keypair.fromSecretKey(Buffer.from(mintAuthoritySecret, 'base64'))
    : treasuryKeypair;

  // If mint authority has no SOL, airdrop to it too
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
        // If airdrop fails for authority, treasury may need to cover fees
      }
    }
  }

  // 3. Create or use existing mint
  let mintAddress: PublicKey;
  if (existingMintAddress) {
    mintAddress = new PublicKey(existingMintAddress);
    // Verify it exists
    await getMint(connection, mintAddress);
  } else {
    // Create a new SPL token mint with 6 decimals (like USDC)
    mintAddress = await createMint(
      connection,
      mintAuthorityKeypair, // payer
      mintAuthorityKeypair.publicKey, // mint authority
      null, // no freeze authority
      6, // 6 decimals
    );
  }

  // 4. Get or create token account for treasury
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    treasuryKeypair, // payer
    mintAddress,
    treasuryKeypair.publicKey,
  );

  // 5. Mint tokens to treasury
  const amountInSmallestUnit = Math.round(amount * 1_000_000);
  const mintSig = await mintTo(
    connection,
    mintAuthorityKeypair, // payer
    mintAddress,
    tokenAccount.address,
    mintAuthorityKeypair, // authority
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
 * Generate a new mint authority keypair (run once, store in env).
 */
export function generateMintAuthority(): { publicKey: string; secretBase64: string } {
  const keypair = Keypair.generate();
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretBase64: Buffer.from(keypair.secretKey).toString('base64'),
  };
}
