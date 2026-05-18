/**
 * Rotas de SpendRequest.
 *
 * - POST /v1/spend-requests   (RF1) — Idempotency-Key obrigatório.
 *   Auth: Bearer cr_ (Agent). Engine roda, decisão é persistida + audit event.
 *   NÃO executa pagamento on-chain ainda (iteração 6).
 *
 * - GET  /v1/spend-requests          (lista filtrada da Company)
 * - GET  /v1/spend-requests/:id      (by id)
 */

import {
  SpendRequestInputSchema,
  type SpendRequestInput,
} from '@aegis/shared';
import { DecisionType } from '@aegis/shared';
import { SpendRequestStatus } from '@prisma/client';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { env } from '../env.js';
import { NotFoundError, PolicyRejectedError, ValidationError } from '../lib/errors.js';
import { extractIdempotencyKey } from '../lib/idempotency.js';
import {
  createSpendRequest,
  serializeSpendRequest,
} from '../services/spend-request.js';

const ListQuery = z.object({
  status: z.nativeEnum(SpendRequestStatus).optional(),
  agentId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const spendRequestsRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ----- POST /v1/spend-requests -----
  app.post('/v1/spend-requests', async (request, reply) => {
    const agent = request.requireAgent();
    const idempotencyKey = extractIdempotencyKey(
      request.headers['idempotency-key'] as string | undefined,
    );
    const body: SpendRequestInput = SpendRequestInputSchema.parse(request.body);

    const { spendRequest, reused } = await createSpendRequest(app.prisma, {
      agent,
      body,
      idempotencyKey,
    });

    const serialized = serializeSpendRequest(spendRequest, {
      withStellarExpertUrl: true,
      network: env.STELLAR_NETWORK,
    });

    // Status code mapping
    if (spendRequest.decision === DecisionType.REJECTED) {
      // Já está persistida com audit; comportamento RFC 7807: 422
      throw new PolicyRejectedError(
        spendRequest.decisionReason ?? 'rejected by policy',
        (spendRequest.metadata as Record<string, string>).ruleHit as never,
        spendRequest.id,
      );
    }

    if (spendRequest.decision === DecisionType.REQUIRES_APPROVAL) {
      reply.code(202);
      return serialized;
    }

    // APPROVED (execução on-chain pendente — virá na iteração 6)
    reply.code(reused ? 200 : 201);
    return serialized;
  });

  // ----- GET /v1/spend-requests -----
  app.get('/v1/spend-requests', async (request) => {
    const agent = request.requireAgent();
    const query = ListQuery.parse(request.query);

    const items = await app.prisma.spendRequest.findMany({
      where: {
        companyId: agent.companyId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.agentId ? { agentId: query.agentId } : {}),
        ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });

    return {
      data: items.map((i) =>
        serializeSpendRequest(i, { withStellarExpertUrl: true, network: env.STELLAR_NETWORK }),
      ),
    };
  });

  // ----- GET /v1/spend-requests/:id -----
  app.get<{ Params: { id: string } }>('/v1/spend-requests/:id', async (request) => {
    const agent = request.requireAgent();
    const found = await app.prisma.spendRequest.findFirst({
      where: { id: request.params.id, companyId: agent.companyId },
    });
    if (!found) throw new NotFoundError(`SpendRequest ${request.params.id} not found`);
    return serializeSpendRequest(found, {
      withStellarExpertUrl: true,
      network: env.STELLAR_NETWORK,
    });
  });
};

export default spendRequestsRoute;
