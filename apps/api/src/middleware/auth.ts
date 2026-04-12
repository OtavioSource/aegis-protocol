/**
 * @file auth.ts
 * @package apps/api
 *
 * ═══════════════════════════════════════════════════════════════
 *  API KEY AUTHENTICATION — AGENT IDENTITY LAYER
 * ═══════════════════════════════════════════════════════════════
 *
 * Aegis Protocol agents authenticate using API keys in the format:
 *   Authorization: Bearer cr_<40-character nanoid>
 *
 * Security design:
 *
 *   - API keys are NEVER stored in plaintext. Only a SHA-256 hash
 *     is persisted in the `agents.apiKeyHash` column.
 *   - The raw key is returned ONCE at agent registration and never
 *     again. If lost, the agent must be re-registered.
 *   - Lookup is O(1) via unique index on `apiKeyHash`.
 *   - Timing-safe comparison is implicit: we look up by hash equality
 *     in the DB rather than doing an in-memory string compare.
 *
 * Used by:
 *   - spend-requests.ts: inline auth (not preHandler) to attach agent
 *     context before processing the spend request
 *   - Could be used as Fastify preHandler for admin-protected routes
 *
 * Why SHA-256 and not bcrypt?
 *   API keys are high-entropy random strings (40 chars of nanoid ≈ 238 bits),
 *   so brute-force is computationally infeasible. bcrypt's slow hashing would
 *   add latency to every request with no meaningful security benefit here.
 *   bcrypt is for low-entropy secrets like user passwords.
 */

import { createHash } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * hashApiKey() — deterministic SHA-256 hash of a raw API key.
 *
 * Used both at key creation (to store the hash) and at key verification
 * (to look up the hash in the DB). The key itself is never persisted.
 */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/**
 * verifyAgentApiKey() — Fastify preHandler for agent-authenticated routes.
 *
 * Validates the Bearer token, resolves the agent from DB, and attaches
 * `agentContext` to the request for downstream handlers to use.
 *
 * If validation fails, replies immediately with 401 — no downstream code runs.
 *
 * Usage:
 *   app.post('/some-route', { preHandler: verifyAgentApiKey }, handler)
 *
 * Note: spend-requests.ts does inline auth instead of using this as a
 * preHandler, because it needs to load policy + budget in the same query.
 */
export async function verifyAgentApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.unauthorized('Missing or invalid Authorization header');
  }

  // Strip "Bearer " prefix to get the raw key
  const apiKey = authHeader.slice(7);
  const keyHash = hashApiKey(apiKey);

  // Single DB lookup by hash — no plaintext key ever hits the DB
  const agent = await request.server.prisma.agent.findUnique({
    where: { apiKeyHash: keyHash },
    include: { company: true },
  });

  if (!agent) {
    return reply.unauthorized('Invalid API key');
  }

  // Make agent available to downstream route handlers
  // without requiring a second DB round-trip
  (request as FastifyRequest & { agentContext: typeof agent }).agentContext = agent;
}
