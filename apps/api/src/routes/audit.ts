/**
 * Rotas de Audit (consulta do audit log).
 *
 * - GET /v1/audit          (lista filtrada)
 * - GET /v1/audit/:id      (by id)
 *
 * sorobanTxHash NULL no MVP — emissão on-chain do contrato aegis_audit
 * vem na iteração 11.
 */

import { EventType } from '@prisma/client';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { NotFoundError } from '../lib/errors.js';

const ListQuery = z.object({
  eventType: z.nativeEnum(EventType).optional(),
  spendRequestId: z.string().uuid().optional(),
  actor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

const auditRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/v1/audit', async (request) => {
    const caller = request.requireAuth();
    const query = ListQuery.parse(request.query);

    const where = {
      companyId: caller.companyId,
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.spendRequestId ? { spendRequestId: query.spendRequestId } : {}),
      ...(query.actor ? { actor: query.actor } : {}),
    };

    const [items, total] = await Promise.all([
      app.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.skip,
      }),
      app.prisma.auditEvent.count({ where }),
    ]);

    return { data: items, total };
  });

  app.get<{ Params: { id: string } }>('/v1/audit/:id', async (request) => {
    const caller = request.requireAuth();
    const found = await app.prisma.auditEvent.findFirst({
      where: { id: request.params.id, companyId: caller.companyId },
    });
    if (!found) throw new NotFoundError(`AuditEvent ${request.params.id} not found`);
    return found;
  });
};

export default auditRoute;
