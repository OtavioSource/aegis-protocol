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

export type WalletInfo = {
  publicKey: string;
  encryptedSecret: string;
};

export type TransferResult = {
  signature: string;
  explorerUrl: string;
};

/**
 * Treasury service for Solana devnet operations.
 * All operations are isolated here — no Solana SDK code outside this package.
 */
export class TreasuryService {
  private connection: Connection;
  private network: 'devnet' | 'mainnet-beta';

  constructor(network: 'devnet' | 'mainnet-beta' = 'devnet') {
    this.network = network;
    this.connection = new Connection(DEVNET_RPC_URL, 'confirmed');
  }

  /**
   * Generate a new Solana keypair for a treasury.
   * In production, encrypt the secret key before storing.
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
   * Restore a keypair from stored secret.
   */
  private restoreKeypair(encryptedSecret: string): Keypair {
    const secretKey = Buffer.from(encryptedSecret, 'base64');
    return Keypair.fromSecretKey(secretKey);
  }

  /**
   * Airdrop SOL for transaction fees.
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
   * Get SOL balance for a wallet.
   */
  async getSolBalance(walletAddress: string): Promise<number> {
    const publicKey = new PublicKey(walletAddress);
    const lamports = await this.connection.getBalance(publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  /**
   * Get USDC balance for a wallet.
   * Returns 0 if no token account exists.
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
   * Transfer USDC (or configured demo token) from treasury to a recipient.
   * Returns transaction signature for audit log.
   *
   * On devnet, uses DEVNET_DEMO_MINT_ADDRESS env var if set, otherwise falls back to
   * Circle's devnet USDC mint.
   */
  async transferUsdc(
    fromEncryptedSecret: string,
    toWalletAddress: string,
    amount: number,
    usdcMint?: PublicKey,
  ): Promise<TransferResult> {
    const resolvedMint = usdcMint ?? (
      process.env['DEVNET_DEMO_MINT_ADDRESS']
        ? new PublicKey(process.env['DEVNET_DEMO_MINT_ADDRESS'])
        : DevnetUsdcMint
    );
    const fromKeypair = this.restoreKeypair(fromEncryptedSecret);
    const toPublicKey = new PublicKey(toWalletAddress);

    // Get or create token accounts
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      fromKeypair,
      resolvedMint,
      fromKeypair.publicKey,
    );

    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      fromKeypair,
      resolvedMint,
      toPublicKey,
    );

    // USDC has 6 decimals
    const amountInMicroUsdc = Math.round(amount * 1_000_000);

    const signature = await transfer(
      this.connection,
      fromKeypair,
      fromTokenAccount.address,
      toTokenAccount.address,
      fromKeypair.publicKey,
      amountInMicroUsdc,
    );

    return {
      signature,
      explorerUrl: explorerTxUrl(signature, this.network),
    };
  }

  /**
   * Freeze a treasury (kill switch).
   * In a real implementation, this would revoke delegate authority.
   * For MVP, we track this in DB — the TreasuryStatus.FROZEN blocks further transfers.
   */
  async freezeTreasury(walletAddress: string): Promise<void> {
    // Mark as frozen — actual on-chain freeze would use setAuthority()
    // For MVP: DB status = FROZEN is the enforcement mechanism
    console.log(`Treasury ${walletAddress} marked as frozen`);
  }

  /**
   * Confirm a transaction and return its details.
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
