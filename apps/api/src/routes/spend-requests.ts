/**
 * Rotas de SpendRequest.
 *
 * - POST /v1/spend-requests   (RF1) — Idempotency-Key obrigatório.
 *   Fluxo síncrono completo:
 *     1. Auth + idempotency
 *     2. Engine avalia política → persiste decisão + audit event
 *     3. Se APPROVED → executa Payment USDC on-chain (síncrono ~3-5s testnet)
 *     4. Resposta inclui txHash quando executado com sucesso
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
import { NotFoundError, PolicyRejectedError } from '../lib/errors.js';
import { extractIdempotencyKey } from '../lib/idempotency.js';
import { executeSpendRequestPayment } from '../services/payment-executor.js';
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

    // Status code mapping para REJECTED — RFC 7807 422
    if (spendRequest.decision === DecisionType.REJECTED) {
      throw new PolicyRejectedError(
        spendRequest.decisionReason ?? 'rejected by policy',
        (spendRequest.metadata as Record<string, string>).ruleHit as never,
        spendRequest.id,
      );
    }

    // REQUIRES_APPROVAL — não executa, retorna 202
    if (spendRequest.decision === DecisionType.REQUIRES_APPROVAL) {
      reply.code(202);
      return serializeSpendRequest(spendRequest, {
        withStellarExpertUrl: true,
        network: env.STELLAR_NETWORK,
      });
    }

    // APPROVED — executa Payment USDC on-chain (síncrono).
    // Reused (idempotency hit) NÃO re-executa: retorna estado atual.
    if (!reused) {
      await executeSpendRequestPayment(app.prisma, { app, spendRequestId: spendRequest.id });
    }

    // Re-lê SpendRequest para retornar com txHash/status atualizados
    const final = await app.prisma.spendRequest.findUnique({
      where: { id: spendRequest.id },
    });
    if (!final) throw new NotFoundError(`SpendRequest ${spendRequest.id} not found after execution`);

    const serialized = serializeSpendRequest(final, {
      withStellarExpertUrl: true,
      network: env.STELLAR_NETWORK,
    });

    // Status code: 201 se criou (mesmo se on-chain falhou — registro persistido)
    //              200 se idempotency reuse
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
