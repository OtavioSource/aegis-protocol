/**
 * @file solana-pay.ts
 * @package @aegis/solana
 *
 * ═══════════════════════════════════════════════════════════════
 *  SOLANA PAY — VENDOR INVOICE URI GENERATION
 * ═══════════════════════════════════════════════════════════════
 *
 * Implements the Solana Pay URI spec (SIMD-0057):
 *   solana:<recipient>?amount=<amount>&spl-token=<mint>&reference=<ref>&label=<label>&message=<msg>
 *
 * Use case: vendor dashboard generates a QR code URI. AI agent scans it
 * (or receives it via webhook), calls aegis.pay(uri) which:
 *   1. Parses the URI → extracts amount, recipient, reference
 *   2. Submits a SpendRequest to Aegis API
 *   3. Policy evaluates (same governance flow as any other spend request)
 *   4. If approved, Aegis executes the SPL token transfer to the vendor wallet
 *
 * This creates "Solana Pay as agent infrastructure" — the payment rail agents
 * use to pay vendors in a governed, auditable way.
 *
 * URI format (per Solana Pay spec):
 *   solana:<recipient>
 *     ?amount=<decimal>          — token amount (6 decimals for USDC)
 *     &spl-token=<mint>          — SPL token mint address (USDC mint)
 *     &reference=<pubkey>        — used to track the on-chain payment
 *     &label=<string>            — vendor name (shown in wallets)
 *     &message=<string>          — invoice description
 *
 * Note: We implement the URI builder manually (no @solana/pay dep) because:
 *   1. The spec is simple enough to build from URL primitives
 *   2. Keeps the solana package lightweight for agent environments
 *   3. Avoids peer-dep conflicts with web3.js versions
 */

import { PublicKey, Keypair } from '@solana/web3.js';
import { explorerAddressUrl } from './constants.js';

export type SolanaPayUriParams = {
  recipient: string;    // Vendor wallet address (Solana public key, base58)
  amount: number;       // Token amount (human-readable, e.g. 25.00 for 25 USDC)
  splTokenMint: string; // SPL token mint address (USDC mint)
  reference?: string;   // Optional: Solana public key for on-chain tracking
  label?: string;       // Vendor display name (shown in mobile wallets)
  message?: string;     // Invoice description
};

export type SolanaPayUri = {
  uri: string;         // Full Solana Pay URI (solana:...)
  reference: string;   // Reference public key (generated if not provided)
  explorerUrl: string; // Solana Explorer link for the reference address
};

export type ParsedSolanaPayUri = {
  recipient: string;
  amount: number;
  splTokenMint: string | null;
  reference: string | null;
  label: string | null;
  message: string | null;
};

/**
 * generateSolanaPayUri() — build a Solana Pay URI for a vendor invoice.
 *
 * Generates a fresh reference keypair if not provided. The reference is
 * a one-time-use public key that can be queried on-chain to find the
 * corresponding payment transaction (via Solana's `getSignaturesForAddress`).
 *
 * @example
 * const { uri } = generateSolanaPayUri({
 *   recipient: 'So11...vendor',
 *   amount: 25.00,
 *   splTokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
 *   label: 'OpenAI',
 *   message: 'GPT-4 API access for April campaign',
 * });
 * // → "solana:So11...vendor?amount=25&spl-token=4zMM...&reference=Ref1...&label=OpenAI&message=GPT-4..."
 */
export function generateSolanaPayUri(params: SolanaPayUriParams): SolanaPayUri {
  // Validate recipient is a valid Solana public key
  const recipientPubkey = new PublicKey(params.recipient);
  const splMintPubkey = new PublicKey(params.splTokenMint);

  // Generate a fresh reference keypair for on-chain tracking if not provided
  const referenceKeypair = Keypair.generate();
  const reference = params.reference ?? referenceKeypair.publicKey.toBase58();

  // Build the URI per the Solana Pay spec
  const url = new URL(`solana:${recipientPubkey.toBase58()}`);
  url.searchParams.set('amount', String(params.amount));
  url.searchParams.set('spl-token', splMintPubkey.toBase58());
  url.searchParams.set('reference', reference);
  if (params.label) url.searchParams.set('label', params.label);
  if (params.message) url.searchParams.set('message', params.message);

  return {
    uri: url.toString(),
    reference,
    explorerUrl: explorerAddressUrl(reference),
  };
}

/**
 * parseSolanaPayUri() — parse a Solana Pay URI into its components.
 *
 * Used by the Aegis SDK's pay() method to extract amount, recipient, and
 * reference from a vendor-generated URI, then submit a governed SpendRequest.
 *
 * @throws if the URI scheme is not 'solana:' or if amount is missing/invalid.
 */
export function parseSolanaPayUri(uri: string): ParsedSolanaPayUri {
  // The URI format is solana:<recipient>?params, which isn't a standard URL scheme.
  // We parse it by replacing the scheme for URL parsing, then restore the recipient.
  if (!uri.startsWith('solana:')) {
    throw new Error(`Invalid Solana Pay URI: must start with 'solana:'`);
  }

  // Extract recipient (everything between 'solana:' and '?')
  const withoutScheme = uri.slice('solana:'.length);
  const questionMark = withoutScheme.indexOf('?');
  const recipient = questionMark === -1 ? withoutScheme : withoutScheme.slice(0, questionMark);
  const queryString = questionMark === -1 ? '' : withoutScheme.slice(questionMark);

  // Parse query params using URLSearchParams
  const params = new URLSearchParams(queryString);

  const amountStr = params.get('amount');
  if (!amountStr) throw new Error('Solana Pay URI missing required amount parameter');
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) throw new Error(`Invalid amount in Solana Pay URI: ${amountStr}`);

  // Validate recipient is a valid Solana public key
  try {
    new PublicKey(recipient);
  } catch {
    throw new Error(`Invalid recipient public key in Solana Pay URI: ${recipient}`);
  }

  return {
    recipient,
    amount,
    splTokenMint: params.get('spl-token'),
    reference: params.get('reference'),
    label: params.get('label'),
    message: params.get('message'),
  };
}
