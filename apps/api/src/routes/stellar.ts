/**
 * @file stellar.ts
 * @package apps/api
 *
 * ═══════════════════════════════════════════════════════════════
 *  STELLAR-SPECIFIC ENDPOINTS — PATH PAYMENT QUOTES
 * ═══════════════════════════════════════════════════════════════
 *
 * Lightweight HTTP endpoints for Stellar-only utilities. Currently:
 *
 *   GET /stellar/path-quote — quote a cross-currency atomic swap
 *
 * These endpoints don't fit the chain-agnostic SettlementAdapter model
 * (Solana has no native cross-currency equivalent), so they live in a
 * dedicated file rather than being shoehorned into spend-requests.ts.
 *
 * Quotes are advisory: the path's source amount may shift between quote
 * and execution as the orderbook moves. The slippage buffer applied in
 * findStrictReceivePath() protects the sender from large adverse moves.
 */

import type { FastifyInstance } from 'fastify';
import { getSettlementAdapter } from '../services/settlement.js';

export async function stellarRoutes(app: FastifyInstance) {
  // ─── GET /stellar/path-quote ──────────────────────────────────────────────
  // Quote a cross-currency atomic swap on Stellar.
  //
  // Query params:
  //   sourceAsset  — asset code the sender pays from (e.g. USDC)
  //   receiveAsset — asset code the recipient gets (e.g. EURC)
  //   amount       — exact amount the recipient receives
  //   network      — stellar-testnet | stellar-mainnet
  //   fromAccount  — sender's G... address (for liquidity reachability check)
  //
  // Response:
  //   { sourceAsset, receiveAsset, receiveAmount, sourceMax, effectiveRate,
  //     path: ['XLM'], validUntil: ISO timestamp }
  //
  // Returns 404 with explanation if no liquidity path exists.
  app.get<{
    Querystring: {
      sourceAsset?: string;
      receiveAsset?: string;
      amount?: string;
      network?: string;
      fromAccount?: string;
    };
  }>('/stellar/path-quote', async (request, reply) => {
    const { sourceAsset, receiveAsset, amount: amountStr, network, fromAccount } = request.query;

    if (!sourceAsset || !receiveAsset || !amountStr || !network || !fromAccount) {
      return reply.badRequest(
        'Missing required query params: sourceAsset, receiveAsset, amount, network, fromAccount',
      );
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      return reply.badRequest(`Invalid amount: ${amountStr}`);
    }

    if (network !== 'stellar-testnet' && network !== 'stellar-mainnet') {
      return reply.badRequest(
        `Path quotes only supported on Stellar networks. Got: ${network}`,
      );
    }

    if (sourceAsset === receiveAsset) {
      return reply.badRequest(
        'Path quotes are for cross-currency swaps. For same-asset transfers, ' +
          'use POST /spend-requests directly without a quote.',
      );
    }

    const adapter = await getSettlementAdapter(network);

    // getPathQuote is optional on the adapter contract — defensive check
    if (!adapter.getPathQuote) {
      return reply.badRequest(
        `Adapter for ${network} does not support path quotes`,
      );
    }

    try {
      const quote = await adapter.getPathQuote({
        sourceAsset,
        receiveAsset,
        receiveAmount: amount,
        fromAccount,
      });

      if (!quote) {
        return reply.notFound(
          `No liquidity path from ${sourceAsset} to ${receiveAsset} for ${amount}. ` +
            `Stellar DEX may not have sufficient depth on this pair.`,
        );
      }

      return quote;
    } catch (err) {
      app.log.error({ err }, '[stellar:path-quote] failed');
      return reply.internalServerError(
        `Path quote failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}
