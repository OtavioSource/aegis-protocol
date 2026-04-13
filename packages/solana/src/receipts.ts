/**
 * @file receipts.ts
 * @package @aegis/solana
 *
 * ═══════════════════════════════════════════════════════════════
 *  CNFT AUDIT RECEIPTS — ON-CHAIN POLICY DECISION LOG
 * ═══════════════════════════════════════════════════════════════
 *
 * Every policy decision (APPROVED / REJECTED / REQUIRES_APPROVAL) emits
 * a compressed NFT (cNFT) via Metaplex Bubblegum onto a Merkle tree
 * owned by Aegis Protocol. This makes the audit log:
 *
 *   - On-chain verifiable: anyone can inspect the tree on Solana Explorer
 *   - Tamper-proof: Merkle proof links each receipt to the tree root
 *   - Cost-efficient: cNFTs cost ~$0.00005 per receipt (vs ~$0.20 for standard NFTs)
 *
 * Architecture:
 *   Company -> 1 Merkle tree (created lazily on first spend request)
 *   Each SpendRequest decision -> 1 cNFT leaf on that tree
 *
 * Merkle tree parameters (demo):
 *   maxDepth=14 -> 2^14 = 16,384 receipts per company
 *   maxBufferSize=64 -> supports up to 64 concurrent mints
 *
 * Requirements:
 *   AEGIS_DELEGATE_SECRET -- payer keypair (base64). Needs ~0.1 SOL for tree
 *   creation and ~0.000005 SOL per mint on devnet.
 *
 * Failure handling:
 *   mintDecisionReceipt() always returns null on error -- receipt failures
 *   never break the governance flow. DB audit log is written regardless.
 */

import {
  mplBubblegum,
  createTree,
  mintV1,
  parseLeafFromMintV1Transaction,
  TokenProgramVersion,
} from '@metaplex-foundation/mpl-bubblegum';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  keypairIdentity,
  generateSigner,
  none,
  publicKey as toUmiPubkey,
} from '@metaplex-foundation/umi';
import { explorerTxUrl, explorerAddressUrl } from './constants.js';

export type MerkleTreeResult = {
  treeAddress: string;
  txSignature: string;
  explorerUrl: string;
};

export type ReceiptMintResult = {
  assetId: string;
  treeAddress: string;
  leafIndex: number;
  txSignature: string;
  explorerUrl: string;
};

function makeUmi(payerSecretBase64: string) {
  const rpcUrl = process.env['SOLANA_RPC_URL'] ?? 'https://api.devnet.solana.com';
  const umi = createUmi(rpcUrl).use(mplBubblegum());
  const secretBytes = new Uint8Array(Buffer.from(payerSecretBase64, 'base64'));
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(secretBytes);
  umi.use(keypairIdentity(umiKeypair));
  return umi;
}

function umiSigToString(sig: Uint8Array): string {
  return Buffer.from(sig).toString('base64url');
}

/**
 * createCompanyMerkleTree() -- allocate a Bubblegum Merkle tree for a company.
 *
 * Called once per company (lazily on first spend request). Costs ~0.1 SOL
 * on devnet. Payer is AEGIS_DELEGATE_SECRET.
 */
export async function createCompanyMerkleTree(
  payerSecretBase64: string,
): Promise<MerkleTreeResult> {
  const umi = makeUmi(payerSecretBase64);
  const merkleTree = generateSigner(umi);

  // createTree returns Promise<TransactionBuilder> in Bubblegum v4 — must await before sendAndConfirm
  const treeBuilder = await createTree(umi, {
    merkleTree,
    maxDepth: 14,
    maxBufferSize: 64,
  });
  const { signature } = await treeBuilder.sendAndConfirm(umi);

  const treeAddress = merkleTree.publicKey as string;

  return {
    treeAddress,
    txSignature: umiSigToString(signature),
    explorerUrl: explorerAddressUrl(treeAddress),
  };
}

/**
 * mintDecisionReceipt() -- mint a cNFT receipt for a policy decision.
 *
 * Emits one compressed NFT onto the company's Merkle tree encoding the
 * decision, vendor, amount and agent. Returns null on any error.
 */
export async function mintDecisionReceipt(params: {
  treeAddress: string;
  payerSecretBase64: string;
  ownerAddress?: string; // defaults to payer (delegate) wallet if not provided
  spendRequestId: string;
  decision: string;
  agentId: string;
  vendor: string;
  amount: number;
  matchedRule?: string;
}): Promise<ReceiptMintResult | null> {
  try {
    const umi = makeUmi(params.payerSecretBase64);

    const metadataUri = `https://api.aegis.protocol/receipts/${params.spendRequestId}/metadata.json`;

    // Owner defaults to the payer (delegate) wallet if not explicitly provided
    const leafOwner = params.ownerAddress
      ? toUmiPubkey(params.ownerAddress)
      : umi.identity.publicKey;

    const { signature } = await mintV1(umi, {
      leafOwner,
      merkleTree: toUmiPubkey(params.treeAddress),
      metadata: {
        name: `Aegis Receipt ${params.spendRequestId.slice(-8).toUpperCase()}`,
        symbol: 'AEGIS',
        uri: metadataUri,
        sellerFeeBasisPoints: 0,
        collection: none(),
        creators: [],
        isMutable: false,
        primarySaleHappened: false,
        editionNonce: none(),
        tokenStandard: none(),
        uses: none(),
        tokenProgramVersion: TokenProgramVersion.Original,
      },
    }).sendAndConfirm(umi);

    const txSig = umiSigToString(signature);

    // parseLeafFromMintV1Transaction returns a LeafSchema with:
    //   leaf.id    = asset ID (PublicKey) — the canonical cNFT address for DAS API
    //   leaf.nonce = leaf index within the tree (bigint)
    const leaf = await parseLeafFromMintV1Transaction(umi, signature);

    return {
      assetId: leaf.id as string,
      treeAddress: params.treeAddress,
      leafIndex: Number(leaf.nonce),
      txSignature: txSig,
      explorerUrl: explorerTxUrl(txSig, 'devnet'),
    };
  } catch (err) {
    console.error('[aegis:receipt] cNFT mint failed:', err);
    return null;
  }
}
