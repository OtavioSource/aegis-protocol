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
 * 4. Cache LRU em memória: `apiKey → agent` por 30s (TTL curto, defesa em profundidade).
 *    - Evita bcrypt em hot path.
 *    - Revogação imediata: rotas que mudam Agent.status (DELETE /v1/agents/:id,
 *      PATCH /v1/agents/:id, rotate-key) chamam `app.invalidateAgentCache(agentId)`
 *      pra remover entradas obsoletas — fecha a janela de uso pós-revoke.
 */

import type { Agent } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { LRUCache } from 'lru-cache';

import { UnauthorizedError } from '../lib/errors.js';

const API_KEY_PREFIX_LENGTH = 11; // "cr_" + 8 chars
const CACHE_MAX = 1_000;
/**
 * 30 segundos — janela máxima entre revogação e enforcement em produção, caso
 * `invalidateAgentCache` não seja chamado por algum motivo. Trade-off contra
 * custo de bcrypt: aceitável porque LRU já reduz pressão.
 */
const CACHE_TTL_MS = 30 * 1_000;

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Remove todas as entradas do auth cache que referenciam o agentId.
     * MUST ser chamado pelas rotas que mudam Agent.status (revoke, suspend,
     * rotate-key, patch com status=REVOKED) — caso contrário, uma API key
     * revogada/rotacionada continua válida até o TTL expirar.
     */
    invalidateAgentCache(agentId: string): void;
  }

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

  app.decorate('invalidateAgentCache', (agentId: string) => {
    // LRUCache não tem index reverso; itera as entradas e remove as do agente.
    // OK pra MAX=1000 e revogação rara (~O(1000) op).
    for (const [key, value] of cache.entries()) {
      if (value.id === agentId) {
        cache.delete(key);
      }
    }
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

    // Cache miss → DB lookup + bcrypt (filter on status=ACTIVE — REVOKED/SUSPENDED
    // são rejeitados mesmo se a key bater).
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
