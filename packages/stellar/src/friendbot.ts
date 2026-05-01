/**
 * @file friendbot.ts
 * @package @aegis/stellar
 *
 * ═══════════════════════════════════════════════════════════════
 *  FRIENDBOT — STELLAR TESTNET ACCOUNT FUNDING
 * ═══════════════════════════════════════════════════════════════
 *
 * Friendbot is the Stellar Foundation's testnet faucet. It funds any
 * G... address with 10,000 XLM, creating the account on-chain.
 *
 * Stellar requires accounts to hold a minimum balance reserve before they
 * can submit any operation (1 XLM base reserve + 0.5 XLM per trustline).
 * 10,000 XLM is more than enough for demo purposes.
 *
 * Equivalent of `connection.requestAirdrop()` on Solana devnet.
 *
 * Friendbot only works on testnet. For mainnet, fund accounts manually.
 *
 * Source: https://developers.stellar.org/docs/learn/fundamentals/networks
 */

import { STELLAR_FRIENDBOT_URL } from './constants.js';

export type FriendbotResult = {
  /** Tx hash of the create-account transaction Friendbot submitted */
  txHash: string;
  /** Funded amount (always 10,000 XLM on testnet) */
  fundedAmount: number;
};

/**
 * fundTestnetAccount() — request Friendbot to create + fund a testnet account.
 *
 * The account doesn't need to exist before this call. Friendbot submits a
 * createAccount operation that pays 10,000 XLM to the target address from
 * the Friendbot's funding account. The account exists on-chain after the tx.
 *
 * Throws if Friendbot is unreachable or if the account already exists with
 * a balance (Friendbot rejects re-funding to prevent abuse).
 */
export async function fundTestnetAccount(publicKey: string): Promise<FriendbotResult> {
  const url = `${STELLAR_FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`;

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new Error(
      `Friendbot funding failed for ${publicKey}: ${response.status} ${body}`,
    );
  }

  const data = (await response.json()) as { hash?: string };
  if (!data.hash) {
    throw new Error(`Friendbot response missing tx hash: ${JSON.stringify(data)}`);
  }

  return {
    txHash: data.hash,
    fundedAmount: 10_000,
  };
}
