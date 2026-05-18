/**
 * Rotas de Policy.
 *
 * Policies são versionadas e imutáveis (decisão D6 / docs/03 §3.4).
 * "Editar policy" = criar nova versão via POST /v1/policies/:id/new-version;
 * a policy anterior é marcada como `isActive=false`.
 *
 * `PUT/PATCH` em campos das rules NÃO é permitido — preserva auditoria.
 */

import { PolicyRulesSchema } from '@aegis/shared';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { NotFoundError } from '../lib/errors.js';

const CreatePolicyBody = z.object({
  name: z.string().min(1).max(200),
  rules: PolicyRulesSchema,
});

const NewVersionBody = z.object({
  rules: PolicyRulesSchema,
});

const policiesRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ----- LIST (apenas active por default; ?all=true para histórico) -----
  app.get<{ Querystring: { all?: string } }>('/v1/policies', async (request) => {
    const caller = request.requireAgent();
    const includeInactive = request.query.all === 'true';
    const policies = await app.prisma.policy.findMany({
      where: {
        companyId: caller.companyId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: policies };
  });

  // ----- GET BY ID -----
  app.get<{ Params: { id: string } }>('/v1/policies/:id', async (request) => {
    const caller = request.requireAgent();
    const found = await app.prisma.policy.findFirst({
      where: { id: request.params.id, companyId: caller.companyId },
    });
    if (!found) throw new NotFoundError(`Policy ${request.params.id} not found`);
    return found;
  });

  // ----- CREATE (v1 nova) -----
  app.post('/v1/policies', async (request, reply) => {
    const caller = request.requireAgent();
    const body = CreatePolicyBody.parse(request.body);
    const created = await app.prisma.policy.create({
      data: {
        companyId: caller.companyId,
        name: body.name,
        version: 1,
        rules: body.rules as object,
        isActive: true,
      },
    });
    reply.code(201);
    return created;
  });

  // ----- NEW VERSION (deactiva anterior, cria N+1) -----
  app.post<{ Params: { id: string } }>('/v1/policies/:id/new-version', async (request, reply) => {
    const caller = request.requireAgent();
    const body = NewVersionBody.parse(request.body);

    const existing = await app.prisma.policy.findFirst({
      where: { id: request.params.id, companyId: caller.companyId },
    });
    if (!existing) throw new NotFoundError(`Policy ${request.params.id} not found`);

    const newPolicy = await app.prisma.$transaction(async (tx) => {
      // Deactivate version atual
      await tx.policy.update({
        where: { id: existing.id },
        data: { isActive: false },
      });
      // Create N+1
      return tx.policy.create({
        data: {
          companyId: caller.companyId,
          name: existing.name,
          version: existing.version + 1,
          rules: body.rules as object,
          isActive: true,
          supersedesPolicyId: existing.id,
        },
      });
    });

    reply.code(201);
    return newPolicy;
  });
};

export default policiesRoute;
