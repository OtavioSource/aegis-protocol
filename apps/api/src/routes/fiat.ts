/**
 * Rotas /v1/fiat/* — gestão de deposits SEP-24 (fiat → USDC na treasury).
 *
 * - POST /v1/fiat/deposits         — inicia deposit, retorna interactiveUrl
 * - GET  /v1/fiat/deposits         — lista deposits da Company
 * - GET  /v1/fiat/deposits/:id     — status atual (auto-poll se stale)
 * - POST /v1/fiat/deposits/:id/refresh — força poll on-demand
 *
 * Auth: Bearer cr_ (Agent). RBAC mais granular vem na iter 10 com NextAuth.
 */

import { FiatTransactionStatus } from '@prisma/client';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { env } from '../env.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import {
  initiateFiatDeposit,
  pollAndSyncDeposit,
  serializeFiatDeposit,
} from '../services/fiat-deposit.js';

const InitiateDepositBody = z.object({
  amountCents: z.number().int().positive(),
  asset: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Z0-9]+$/)
    .default('USDC'),
});

const ListQuery = z.object({
  status: z.nativeEnum(FiatTransactionStatus).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const fiatRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ----- POST /v1/fiat/deposits -----
  app.post('/v1/fiat/deposits', async (request, reply) => {
    const caller = request.requireAgent();
    const body = InitiateDepositBody.parse(request.body);

    // No MVP, userId placeholder: primeiro OWNER da Company (mesmo que approvals)
    const owner = await app.prisma.user.findFirst({
      where: { companyId: caller.companyId, role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) {
      throw new ConflictError(
        `Company ${caller.companyId} has no OWNER user — required to initiate fiat deposit.`,
      );
    }

    const result = await initiateFiatDeposit(app.prisma, {
      app,
      companyId: caller.companyId,
      userId: owner.id,
      amountCents: body.amountCents,
      asset: body.asset,
    });

    reply.code(201);
    return {
      ...serializeFiatDeposit(result.deposit, { network: env.STELLAR_NETWORK }),
      interactiveUrl: result.interactiveUrl,
      expiresAt: result.expiresAt,
    };
  });

  // ----- GET /v1/fiat/deposits -----
  app.get('/v1/fiat/deposits', async (request) => {
    const caller = request.requireAgent();
    const query = ListQuery.parse(request.query);

    const items = await app.prisma.fiatDeposit.findMany({
      where: {
        companyId: caller.companyId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });

    return {
      data: items.map((d) => serializeFiatDeposit(d, { network: env.STELLAR_NETWORK })),
    };
  });

  // ----- GET /v1/fiat/deposits/:id (auto-poll se stale) -----
  app.get<{ Params: { id: string } }>(
    '/v1/fiat/deposits/:id',
    async (request) => {
      const caller = request.requireAgent();
      const existing = await app.prisma.fiatDeposit.findFirst({
        where: { id: request.params.id, companyId: caller.companyId },
      });
      if (!existing) throw new NotFoundError(`FiatDeposit ${request.params.id} not found`);

      // Auto-poll se non-terminal e stale (>30s)
      const synced = await pollAndSyncDeposit(app.prisma, app, existing.id);
      return serializeFiatDeposit(synced, { network: env.STELLAR_NETWORK });
    },
  );

  // ----- POST /v1/fiat/deposits/:id/refresh (poll on-demand) -----
  app.post<{ Params: { id: string } }>(
    '/v1/fiat/deposits/:id/refresh',
    async (request) => {
      const caller = request.requireAgent();
      const existing = await app.prisma.fiatDeposit.findFirst({
        where: { id: request.params.id, companyId: caller.companyId },
      });
      if (!existing) throw new NotFoundError(`FiatDeposit ${request.params.id} not found`);

      const synced = await pollAndSyncDeposit(app.prisma, app, existing.id, { force: true });
      return serializeFiatDeposit(synced, { network: env.STELLAR_NETWORK });
    },
  );
};

export default fiatRoute;
