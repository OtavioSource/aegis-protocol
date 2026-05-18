/**
 * Auth plugin para Agents (Bearer cr_).
 *
 * Decora `request.agent` com a entidade do Agent autenticado e `request.companyId`
 * derivado dele. Rotas que exigem auth fazem `request.requireAgent()`.
 *
 * Estratégia:
 * 1. Lê header `Authorization: Bearer cr_xxx`.
 * 2. Extrai prefix (`cr_` + 8 chars) e busca Agent por `apiKeyPrefix` (indexed).
 * 3. `bcrypt.compare(apiKey, agent.apiKeyHash)` — caro (~10ms), por isso cache.
 * 4. Cache LRU em memória: `apiKey → agent` por 5 minutos.
 *    - Evita bcrypt em hot path.
 *    - Invalidado por TTL; revogação de Agent não é imediata (até 5min).
 *      Para MVP isso é aceitável; revogação imediata seria via Redis pub/sub.
 */

import type { Agent } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { LRUCache } from 'lru-cache';

import { UnauthorizedError } from '../lib/errors.js';

const API_KEY_PREFIX_LENGTH = 11; // "cr_" + 8 chars
const CACHE_MAX = 1_000;
const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutos

declare module 'fastify' {
  interface FastifyRequest {
    agent?: Agent;
    companyId?: string;
    requireAgent(): Agent;
  }
}

const authAgentPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const cache = new LRUCache<string, Agent>({
    max: CACHE_MAX,
    ttl: CACHE_TTL_MS,
  });

  app.decorateRequest('agent', undefined);
  app.decorateRequest('companyId', undefined);
  app.decorateRequest('requireAgent', function (this: FastifyRequest): Agent {
    if (!this.agent) {
      throw new UnauthorizedError('Authentication required (Bearer cr_<apiKey>)');
    }
    return this.agent;
  });

  app.addHook('preHandler', async (request) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return; // sem auth — request continua, rotas decidem se exigem
    }

    const apiKey = authHeader.slice('Bearer '.length).trim();
    if (!apiKey.startsWith('cr_')) {
      throw new UnauthorizedError('Invalid Authorization header format. Expected "Bearer cr_…"');
    }

    // Cache hit
    const cached = cache.get(apiKey);
    if (cached) {
      request.agent = cached;
      request.companyId = cached.companyId;
      return;
    }

    // Cache miss → DB lookup + bcrypt
    const prefix = apiKey.slice(0, API_KEY_PREFIX_LENGTH);
    const candidates = await app.prisma.agent.findMany({
      where: { apiKeyPrefix: prefix, status: 'ACTIVE' },
    });

    for (const candidate of candidates) {
      const matches = await bcrypt.compare(apiKey, candidate.apiKeyHash);
      if (matches) {
        cache.set(apiKey, candidate);
        request.agent = candidate;
        request.companyId = candidate.companyId;
        return;
      }
    }

    throw new UnauthorizedError('Invalid API key');
  });
};

export default fp(authAgentPlugin, {
  name: 'auth-agent',
  dependencies: ['prisma'],
});
