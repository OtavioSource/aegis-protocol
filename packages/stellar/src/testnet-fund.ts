/**
 * @file testnet-fund.ts
 * @package @aegis/stellar
 *
 * ═══════════════════════════════════════════════════════════════
 *  TESTNET FUNDING — DEMO TREASURY PROVISIONING
 * ═══════════════════════════════════════════════════════════════
 *
 * Helpers used by the API's POST /treasuries/:id/fund-demo endpoint
 * to bring a freshly-created Stellar treasury to a working state:
 *
 *   1. Fund with XLM via Friendbot (creates the account on-chain)
 *   2. Establish a trustline to the demo asset (USDC)
 *   3. Optionally receive a starting balance from the demo issuer
 *
 * Mirrors the shape of @aegis/solana/devnet-fund.ts so the API can
 * call either chain's funding helper through the same pattern.
 *
 * Required env vars for full setup:
 *   STELLAR_DEMO_USDC_ISSUER         — public G... of the issuer
 *   STELLAR_DEMO_USDC_ISSUER_SECRET  — base64 of the issuer's S... secret
 * If only the public issuer is set, the trustline is established but no
 * USDC is minted (the operator can fund manually).
 */

import {
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  Asset,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import {
  horizonUrl,
  networkPassphrase,
  stellarExpertTxUrl,
  type StellarNetwork,
} from './constants.js';
import { fundTestnetAccount } from './friendbot.js';

export type StellarFundResult = {
  walletAddress: string;
  network: StellarNetwork;
  /** Friendbot tx that funded the account with XLM (10,000 XLM testnet) */
  fundTxHash: string;
  fundExplorerUrl: string;
  /** Trustline establishment tx — null if no asset issuer was configured */
  trustlineTxHash: string | null;
  trustlineExplorerUrl: string | null;
  /** USDC payment from issuer to treasury — null if no issuer secret was configured */
  assetTxHash: string | null;
  assetExplorerUrl: string | null;
  /** Amount of USDC sent to the treasury from issuer (0 if not configured) */
  assetAmount: number;
};

/**
 * fundStellarTreasuryForDemo() — full one-shot setup for a Stellar testnet treasury.
 *
 * - Calls Friendbot if the account doesn't yet exist on-chain
 * - Establishes a trustline to USDC using the treasury's own keypair
 * - If STELLAR_DEMO_USDC_ISSUER_SECRET is set, mints `amount` USDC from the
 *   demo issuer to the treasury
 *
 * Throws if Friendbot fails or trustline submission fails. Asset funding
 * is best-effort — if the issuer secret isn't set, the trustline is still
 * established and the operator can fund manually later.
 */
export async function fundStellarTreasuryForDemo(params: {
  network: StellarNetwork;
  treasuryEncryptedSecret: string;
  amount: number;
  /** Optional: skip Friendbot if account already funded (idempotency) */
  skipFriendbotIfFunded?: boolean;
}): Promise<StellarFundResult> {
  const server = new Horizon.Server(horizonUrl(params.network));

  // Decode treasury secret (base64-encoded S... string in storage format)
  const treasurySecret = Buffer.from(params.treasuryEncryptedSecret, 'base64').toString('utf8');
  const treasuryKp = Keypair.fromSecret(treasurySecret);
  const treasuryAddress = treasuryKp.publicKey();

  // ─── Step 1: Friendbot ─────────────────────────────────────────────────
  let fundTxHash: string;
  try {
    const exists = await server.loadAccount(treasuryAddress).then(() => true).catch(() => false);
    if (exists && params.skipFriendbotIfFunded) {
      fundTxHash = 'already-funded';
    } else if (exists) {
      // Account exists already — Friendbot would reject. Skip with note.
      fundTxHash = 'already-funded';
    } else {
      const result = await fundTestnetAccount(treasuryAddress);
      fundTxHash = result.txHash;
    }
  } catch (err) {
    throw new Error(
      `Friendbot funding failed for ${treasuryAddress}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ─── Step 2: Trustline to USDC ─────────────────────────────────────────
  const issuerPubkey = process.env['STELLAR_DEMO_USDC_ISSUER'];
  if (!issuerPubkey) {
    return {
      walletAddress: treasuryAddress,
      network: params.network,
      fundTxHash,
      fundExplorerUrl: stellarExpertTxUrl(fundTxHash, params.network),
      trustlineTxHash: null,
      trustlineExplorerUrl: null,
      assetTxHash: null,
      assetExplorerUrl: null,
      assetAmount: 0,
    };
  }

  const usdcAsset = new Asset('USDC', issuerPubkey);

  // Check if trustline already exists (idempotency)
  let needsTrustline = true;
  try {
    const account = await server.loadAccount(treasuryAddress);
    needsTrustline = !account.balances.some(
      (b) =>
        b.asset_type !== 'native' &&
        b.asset_type !== 'liquidity_pool_shares' &&
        b.asset_code === 'USDC' &&
        b.asset_issuer === issuerPubkey,
    );
  } catch {
    // Account check failed — proceed with trustline attempt
  }

  let trustlineTxHash: string | null = null;
  if (needsTrustline) {
    const treasuryAccount = await server.loadAccount(treasuryAddress);
    const tx = new TransactionBuilder(treasuryAccount, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(params.network),
    })
      .addOperation(Operation.changeTrust({ asset: usdcAsset }))
      .setTimeout(30)
      .build();
    tx.sign(treasuryKp);
    const trustResult = await server.submitTransaction(tx);
    trustlineTxHash = trustResult.hash;
  }

  // ─── Step 3: Mint USDC from issuer to treasury ─────────────────────────
  const issuerSecretEnv = process.env['STELLAR_DEMO_USDC_ISSUER_SECRET'];
  if (!issuerSecretEnv || params.amount <= 0) {
    return {
      walletAddress: treasuryAddress,
      network: params.network,
      fundTxHash,
      fundExplorerUrl: stellarExpertTxUrl(fundTxHash, params.network),
      trustlineTxHash,
      trustlineExplorerUrl: trustlineTxHash ? stellarExpertTxUrl(trustlineTxHash, params.network) : null,
      assetTxHash: null,
      assetExplorerUrl: null,
      assetAmount: 0,
    };
  }

  // Issuer secret can be raw S... or base64. Detect by length/prefix.
  const issuerSecret =
    issuerSecretEnv.length === 56 && issuerSecretEnv.startsWith('S')
      ? issuerSecretEnv
      : Buffer.from(issuerSecretEnv, 'base64').toString('utf8');
  const issuerKp = Keypair.fromSecret(issuerSecret);

  const issuerAccount = await server.loadAccount(issuerKp.publicKey());
  const mintTx = new TransactionBuilder(issuerAccount, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(params.network),
  })
    .addOperation(
      Operation.payment({
        destination: treasuryAddress,
        asset: usdcAsset,
        amount: params.amount.toFixed(7),
      }),
    )
    .setTimeout(30)
    .build();
  mintTx.sign(issuerKp);
  const mintResult = await server.submitTransaction(mintTx);

  return {
    walletAddress: treasuryAddress,
    network: params.network,
    fundTxHash,
    fundExplorerUrl: stellarExpertTxUrl(fundTxHash, params.network),
    trustlineTxHash,
    trustlineExplorerUrl: trustlineTxHash ? stellarExpertTxUrl(trustlineTxHash, params.network) : null,
    assetTxHash: mintResult.hash,
    assetExplorerUrl: stellarExpertTxUrl(mintResult.hash, params.network),
    assetAmount: params.amount,
  };
}

/**
 * establishStellarTrustline() — exposed as POST /treasuries/:id/trustlines.
 *
 * For a Stellar treasury Aegis controls (we have the secret), establish a
 * trustline so it can receive a non-XLM asset. Idempotent — returns null if
 * the trustline already exists.
 */
export async function establishStellarTrustline(params: {
  network: StellarNetwork;
  treasuryEncryptedSecret: string;
  assetCode: string;
  assetIssuer: string;
}): Promise<{ txHash: string | null; explorerUrl: string | null; alreadyExisted: boolean }> {
  const server = new Horizon.Server(horizonUrl(params.network));
  const treasurySecret = Buffer.from(params.treasuryEncryptedSecret, 'base64').toString('utf8');
  const treasuryKp = Keypair.fromSecret(treasurySecret);
  const asset = new Asset(params.assetCode, params.assetIssuer);

  const account = await server.loadAccount(treasuryKp.publicKey());
  const exists = account.balances.some(
    (b) =>
      b.asset_type !== 'native' &&
      b.asset_type !== 'liquidity_pool_shares' &&
      b.asset_code === params.assetCode &&
      b.asset_issuer === params.assetIssuer,
  );

  if (exists) {
    return { txHash: null, explorerUrl: null, alreadyExisted: true };
  }

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(params.network),
  })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(30)
    .build();
  tx.sign(treasuryKp);
  const result = await server.submitTransaction(tx);

  return {
    txHash: result.hash,
    explorerUrl: stellarExpertTxUrl(result.hash, params.network),
    alreadyExisted: false,
  };
}
