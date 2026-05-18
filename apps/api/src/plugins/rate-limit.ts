/**
 * Rate limit plugin — limita requests por Agent (key = apiKey prefix).
 *
 * - Storage: in-memory (LRU). Suficiente para MVP single-instance.
 *   Para multi-instance: trocar por Redis store (futuro).
 * - Limite default: `env.RATE_LIMIT_PER_AGENT_RPS` × 60 = req/min.
 * - Requests não-autenticados (sem Bearer cr_) caem no fallback de IP.
 * - Excede → 429 com `Retry-After` header.
 */

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { env } from '../env.js';

const rateLimitPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_PER_AGENT_RPS * 60, // por minuto
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      // Agent autenticado: usa apiKeyPrefix (estável por Agent)
      if (req.agent) return `agent:${req.agent.apiKeyPrefix}`;
      // Fallback: IP do cliente
      return `ip:${req.ip}`;
    },
    errorResponseBuilder: (_req, ctx) => ({
      type: 'https://aegis-protocol.dev/errors/rate-limit-exceeded',
      title: 'Too many requests',
      status: 429,
      detail: `Rate limit exceeded. Try again in ${Math.ceil(ctx.ttl / 1000)}s.`,
      retryAfterSeconds: Math.ceil(ctx.ttl / 1000),
    }),
  });
};

export default fp(rateLimitPlugin, { name: 'rate-limit', dependencies: ['auth-agent'] });
