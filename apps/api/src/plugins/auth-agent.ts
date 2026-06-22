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
import { verifySessionToken, type VerifiedSession } from '../lib/session-token.js';

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
    /** Humano autenticado via session token (dashboard). Mutuamente exclusivo com `agent`. */
    user?: VerifiedSession;
    companyId?: string;
    requireAgent(): Agent;
    /**
     * Exige auth de **agente OU usuário**. Devolve o `companyId` do tenant.
     * Usar nas rotas de gestão do dashboard (não precisam da identidade do agente).
     */
    requireAuth(): { companyId: string };
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
  app.decorateRequest('user', undefined);
  app.decorateRequest('companyId', undefined);
  app.decorateRequest('requireAgent', function (this: FastifyRequest): Agent {
    if (!this.agent) {
      throw new UnauthorizedError('Authentication required (Bearer cr_<apiKey>)');
    }
    return this.agent;
  });
  app.decorateRequest('requireAuth', function (this: FastifyRequest): { companyId: string } {
    if (!this.companyId) {
      throw new UnauthorizedError(
        'Authentication required (Bearer cr_<apiKey> or session token)',
      );
    }
    return { companyId: this.companyId };
  });

  app.addHook('preHandler', async (request) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return; // sem auth — request continua, rotas decidem se exigem
    }

    const token = authHeader.slice('Bearer '.length).trim();

    // ===== Agente: Bearer cr_… =====
    if (token.startsWith('cr_')) {
      // Cache hit
      const cached = cache.get(token);
      if (cached) {
        request.agent = cached;
        request.companyId = cached.companyId;
        return;
      }

      // Cache miss → DB lookup + bcrypt (filter on status=ACTIVE — REVOKED/SUSPENDED
      // são rejeitados mesmo se a key bater).
      const prefix = token.slice(0, API_KEY_PREFIX_LENGTH);
      const candidates = await app.prisma.agent.findMany({
        where: { apiKeyPrefix: prefix, status: 'ACTIVE' },
      });

      for (const candidate of candidates) {
        const matches = await bcrypt.compare(token, candidate.apiKeyHash);
        if (matches) {
          cache.set(token, candidate);
          request.agent = candidate;
          request.companyId = candidate.companyId;
          return;
        }
      }

      throw new UnauthorizedError('Invalid API key');
    }

    // ===== Humano (dashboard): session token assinado =====
    const session = verifySessionToken(token);
    if (!session) {
      throw new UnauthorizedError('Invalid or expired session token');
    }
    request.user = session;
    request.companyId = session.companyId;
  });
};

export default fp(authAgentPlugin, {
  name: 'auth-agent',
  dependencies: ['prisma'],
});
