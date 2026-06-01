/**
 * Rotas de Agent (CRUD + rotate-key).
 *
 * Auth: apenas chamadas autenticadas como Agent podem listar/ver outros agents
 * da MESMA Company. Mutações (POST/PATCH/DELETE/rotate) ficam abertas para
 * qualquer Agent autenticado no MVP — RBAC granular (OWNER/ADMIN) entra
 * quando NextAuth do dashboard chegar (iteração 10).
 *
 * Para o MVP, qualquer Agent autenticado representa a Company e pode operar.
 */

import { randomBytes } from 'node:crypto';

import { AgentStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../lib/errors.js';

const BCRYPT_ROUNDS = 10;
const API_KEY_PREFIX_LENGTH = 11; // "cr_" + 8 chars

const CreateAgentBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  activePolicyId: z.string().uuid(),
  metadata: z.record(z.unknown()).optional(),
});

const PatchAgentBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2_000).nullable().optional(),
  activePolicyId: z.string().uuid().optional(),
  status: z.nativeEnum(AgentStatus).optional(),
  metadata: z.record(z.unknown()).optional(),
});

function generateApiKey(): { apiKey: string; prefix: string } {
  const apiKey = `cr_${randomBytes(24).toString('base64url')}`;
  return { apiKey, prefix: apiKey.slice(0, API_KEY_PREFIX_LENGTH) };
}

function publicAgent(a: {
  id: string;
  name: string;
  description: string | null;
  apiKeyPrefix: string;
  activePolicyId: string;
  status: AgentStatus;
  metadata: unknown;
  createdAt: Date;
  revokedAt: Date | null;
}) {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    apiKeyPrefix: a.apiKeyPrefix,
    activePolicyId: a.activePolicyId,
    status: a.status,
    metadata: a.metadata,
    createdAt: a.createdAt,
    revokedAt: a.revokedAt,
  };
}

const agentsRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ----- LIST -----
  app.get('/v1/agents', async (request) => {
    const agent = request.requireAgent();
    const agents = await app.prisma.agent.findMany({
      where: { companyId: agent.companyId },
      orderBy: { createdAt: 'desc' },
    });
    return { data: agents.map(publicAgent) };
  });

  // ----- GET BY ID -----
  app.get<{ Params: { id: string } }>('/v1/agents/:id', async (request) => {
    const caller = request.requireAgent();
    const found = await app.prisma.agent.findFirst({
      where: { id: request.params.id, companyId: caller.companyId },
    });
    if (!found) throw new NotFoundError(`Agent ${request.params.id} not found`);
    return publicAgent(found);
  });

  // ----- CREATE -----
  app.post('/v1/agents', async (request, reply) => {
    const caller = request.requireAgent();
    const body = CreateAgentBody.parse(request.body);

    // Validar que a policy pertence à mesma company
    const policy = await app.prisma.policy.findFirst({
      where: { id: body.activePolicyId, companyId: caller.companyId, isActive: true },
    });
    if (!policy) {
      throw new ValidationError(
        `activePolicyId ${body.activePolicyId} not found or not active in this Company`,
      );
    }

    const { apiKey, prefix } = generateApiKey();
    const apiKeyHash = await bcrypt.hash(apiKey, BCRYPT_ROUNDS);

    const created = await app.prisma.agent.create({
      data: {
        companyId: caller.companyId,
        name: body.name,
        description: body.description,
        apiKeyHash,
        apiKeyPrefix: prefix,
        activePolicyId: body.activePolicyId,
        metadata: (body.metadata ?? {}) as object,
      },
    });

    reply.code(201);
    return {
      ...publicAgent(created),
      apiKey, // exibido UMA vez — caller precisa salvar
    };
  });

  // ----- PATCH -----
  app.patch<{ Params: { id: string } }>('/v1/agents/:id', async (request) => {
    const caller = request.requireAgent();
    const body = PatchAgentBody.parse(request.body);

    const existing = await app.prisma.agent.findFirst({
      where: { id: request.params.id, companyId: caller.companyId },
    });
    if (!existing) throw new NotFoundError(`Agent ${request.params.id} not found`);

    if (body.activePolicyId) {
      const policy = await app.prisma.policy.findFirst({
        where: { id: body.activePolicyId, companyId: caller.companyId, isActive: true },
      });
      if (!policy) {
        throw new ValidationError(
          `activePolicyId ${body.activePolicyId} not found or not active in this Company`,
        );
      }
    }

    const updated = await app.prisma.agent.update({
      where: { id: request.params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.activePolicyId !== undefined ? { activePolicyId: body.activePolicyId } : {}),
        ...(body.status !== undefined
          ? {
              status: body.status,
              ...(body.status === AgentStatus.REVOKED ? { revokedAt: new Date() } : {}),
            }
          : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata as object } : {}),
      },
    });
    // Invalida cache de auth se status mudou para algo que não seja ACTIVE,
    // OU se a policy mudou (cache guarda activePolicyId antigo).
    if (
      (body.status !== undefined && body.status !== AgentStatus.ACTIVE) ||
      body.activePolicyId !== undefined
    ) {
      app.invalidateAgentCache(existing.id);
    }
    return publicAgent(updated);
  });

  // ----- ROTATE API KEY -----
  app.post<{ Params: { id: string } }>('/v1/agents/:id/rotate-key', async (request) => {
    const caller = request.requireAgent();
    const existing = await app.prisma.agent.findFirst({
      where: { id: request.params.id, companyId: caller.companyId },
    });
    if (!existing) throw new NotFoundError(`Agent ${request.params.id} not found`);

    const { apiKey, prefix } = generateApiKey();
    const apiKeyHash = await bcrypt.hash(apiKey, BCRYPT_ROUNDS);

    const updated = await app.prisma.agent.update({
      where: { id: request.params.id },
      data: { apiKeyHash, apiKeyPrefix: prefix },
    });
    // Invalida cache: a key anterior continua hashed no LRU até o TTL, ainda
    // funcional. Invalidar fecha a janela em que ambas as keys autenticam.
    app.invalidateAgentCache(existing.id);
    return { ...publicAgent(updated), apiKey };
  });

  // ----- DELETE (soft delete via status=REVOKED) -----
  app.delete<{ Params: { id: string } }>('/v1/agents/:id', async (request, reply) => {
    const caller = request.requireAgent();
    const existing = await app.prisma.agent.findFirst({
      where: { id: request.params.id, companyId: caller.companyId },
    });
    if (!existing) throw new NotFoundError(`Agent ${request.params.id} not found`);

    await app.prisma.agent.update({
      where: { id: request.params.id },
      data: { status: AgentStatus.REVOKED, revokedAt: new Date() },
    });
    // Crítico: invalida o cache do auth-agent. Sem isso, uma API key vazada
    // continuaria válida por até CACHE_TTL_MS após revogação.
    app.invalidateAgentCache(existing.id);
    reply.code(204);
  });
};

export default agentsRoute;
