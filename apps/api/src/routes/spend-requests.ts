/**
 * Rotas de SpendRequest (modelo não-custodial 5a — ADR 0007).
 *
 * - POST /v1/spend-requests   (RF1) — Idempotency-Key obrigatório.
 *     1. Auth + idempotency
 *     2. Engine avalia política → persiste decisão + audit event
 *     3. Se APPROVED → constrói o envelope canônico (XDR não-assinado),
 *        status AWAITING_AGENT_SIGNATURE; o `envelopeXdr` volta no response.
 *
 * - POST /v1/spend-requests/:id/cosign — o agente devolve o envelope assinado;
 *   o Aegis valida (igualdade + assinatura), co-assina e submete on-chain.
 *
 * - GET  /v1/spend-requests          (lista filtrada da Company)
 * - GET  /v1/spend-requests/:id      (by id)
 */

import {
  SpendRequestInputSchema,
  type SpendRequestInput,
} from '@aegis/shared';
import { DecisionType } from '@aegis/shared';
import { type Agent, SpendRequestStatus } from '@prisma/client';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { env } from '../env.js';
import { NotFoundError, PolicyRejectedError, ValidationError } from '../lib/errors.js';
import { extractIdempotencyKey } from '../lib/idempotency.js';
import {
  cosignSpendRequest,
  prepareSpendRequestEnvelope,
} from '../services/multisig-payment.js';
import { emitSorobanAuditEvent } from '../services/soroban-audit.js';
import {
  createSpendRequest,
  serializeSpendRequest,
} from '../services/spend-request.js';
import { AgentStatus } from '@prisma/client';

const ListQuery = z.object({
  status: z.nativeEnum(SpendRequestStatus).optional(),
  agentId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const spendRequestsRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ----- POST /v1/spend-requests -----
  app.post('/v1/spend-requests', async (request, reply) => {
    const { companyId } = request.requireAuth();
    const idempotencyKey = extractIdempotencyKey(
      request.headers['idempotency-key'] as string | undefined,
    );
    const body: SpendRequestInput = SpendRequestInputSchema.parse(request.body);

    // Resolve em nome de qual Agent o spend é submetido:
    // - Caller é Agent e não pediu outro agentId → o próprio caller.
    // - Caller é User (dashboard) OU pediu outro agentId → resolve por `agentId`
    //   (obrigatório quando o caller é usuário, pois não há agente implícito),
    //   validando que pertence à mesma Company e está ACTIVE ("act as agent").
    let agent: Agent;
    if (request.agent && (!body.agentId || body.agentId === request.agent.id)) {
      agent = request.agent;
    } else {
      if (!body.agentId) {
        throw new ValidationError(
          'agentId is required when authenticating as a user (dashboard).',
        );
      }
      const target = await app.prisma.agent.findFirst({
        where: { id: body.agentId, companyId },
      });
      if (!target) {
        throw new ValidationError(`Agent ${body.agentId} not found in this Company.`);
      }
      if (target.status !== AgentStatus.ACTIVE) {
        throw new ValidationError(
          `Agent ${target.id} is ${target.status}; cannot submit spend requests.`,
        );
      }
      agent = target;
    }

    const { spendRequest, reused } = await createSpendRequest(app.prisma, {
      agent,
      body,
      idempotencyKey,
    });

    // Status code mapping para REJECTED — RFC 7807 422
    if (spendRequest.decision === DecisionType.REJECTED) {
      // Fire-and-forget: emite o registro de decisão no contrato Soroban.
      emitSorobanAuditEvent({
        prisma: app.prisma,
        log: app.log,
        spendRequestId: spendRequest.id,
        companyId: spendRequest.companyId,
        agentId: spendRequest.agentId,
        vendorId: spendRequest.vendorId,
        amountCents: spendRequest.amountCents,
        asset: spendRequest.asset,
        policyId: spendRequest.policyId,
        policyVersion:
          (spendRequest.policySnapshot as { version?: number } | null)
            ?.version ?? 1,
        decision: 'Rejected',
        reason: spendRequest.decisionReason ?? 'policy rejected',
        timestampMs: spendRequest.createdAt.getTime(),
      });
      throw new PolicyRejectedError(
        spendRequest.decisionReason ?? 'rejected by policy',
        (spendRequest.metadata as Record<string, string>).ruleHit as never,
        spendRequest.id,
      );
    }

    // REQUIRES_APPROVAL — não executa, retorna 202
    if (spendRequest.decision === DecisionType.REQUIRES_APPROVAL) {
      // Fire-and-forget: registra a decisão "requires human approval" no contrato
      // Soroban (espelha o emit do REJECTED). Guard `!reused` evita evento
      // duplicado on-chain em retry idempotente.
      if (!reused) {
        emitSorobanAuditEvent({
          prisma: app.prisma,
          log: app.log,
          spendRequestId: spendRequest.id,
          companyId: spendRequest.companyId,
          agentId: spendRequest.agentId,
          vendorId: spendRequest.vendorId,
          amountCents: spendRequest.amountCents,
          asset: spendRequest.asset,
          policyId: spendRequest.policyId,
          policyVersion:
            (spendRequest.policySnapshot as { version?: number } | null)?.version ?? 1,
          decision: 'RequiresApproval',
          reason: spendRequest.decisionReason ?? 'human approval required',
          timestampMs: spendRequest.createdAt.getTime(),
        });
      }
      reply.code(202);
      return serializeSpendRequest(spendRequest, {
        withStellarExpertUrl: true,
        network: env.STELLAR_NETWORK,
      });
    }

    // APPROVED — modelo não-custodial (5a): o Aegis NÃO liquida sozinho.
    // Constrói o envelope canônico, persiste-o e transiciona para
    // AWAITING_AGENT_SIGNATURE. O agente assina e chama POST /:id/cosign.
    // Reused (idempotency hit) NÃO re-prepara: retorna o estado atual.
    if (!reused) {
      await prepareSpendRequestEnvelope(app, spendRequest.id);
    }

    // Re-lê SpendRequest para retornar com envelope/status atualizados
    const final = await app.prisma.spendRequest.findUnique({
      where: { id: spendRequest.id },
    });
    if (!final) throw new NotFoundError(`SpendRequest ${spendRequest.id} not found after prepare`);

    const serialized = serializeSpendRequest(final, {
      withStellarExpertUrl: true,
      network: env.STELLAR_NETWORK,
    });

    // Status code: 201 se criou (mesmo se prepare falhou — registro persistido)
    //              200 se idempotency reuse
    reply.code(reused ? 200 : 201);
    return serialized;
  });

  // ----- POST /v1/spend-requests/:id/cosign -----
  // Fase 2 do fluxo não-custodial: o agente devolve o envelope assinado.
  // O Aegis valida (igualdade ao emitido + assinatura do agente), co-assina
  // com a aegis key da company e submete on-chain.
  app.post<{ Params: { id: string }; Body: { signedXdr?: string } }>(
    '/v1/spend-requests/:id/cosign',
    async (request, reply) => {
      const { companyId } = request.requireAuth();
      const signedXdr = request.body?.signedXdr;
      if (!signedXdr || typeof signedXdr !== 'string') {
        throw new ValidationError('signedXdr (string XDR base64) é obrigatório no body.');
      }

      // Garante que a SpendRequest pertence à company do caller.
      const sr = await app.prisma.spendRequest.findFirst({
        where: { id: request.params.id, companyId },
      });
      if (!sr) throw new NotFoundError(`SpendRequest ${request.params.id} not found`);

      const result = await cosignSpendRequest(app, {
        spendRequestId: sr.id,
        signedXdr,
      });

      if (result.status === 'noop') {
        // Estado não elegível (já executada / não aguardando assinatura).
        reply.code(409);
        return { error: 'invalid_state', detail: result.reason };
      }

      const final = await app.prisma.spendRequest.findUnique({ where: { id: sr.id } });
      if (!final) throw new NotFoundError(`SpendRequest ${sr.id} not found after cosign`);
      reply.code(result.status === 'executed' ? 200 : 422);
      return serializeSpendRequest(final, {
        withStellarExpertUrl: true,
        network: env.STELLAR_NETWORK,
      });
    },
  );

  // ----- GET /v1/spend-requests -----
  app.get('/v1/spend-requests', async (request) => {
    const { companyId } = request.requireAuth();
    const query = ListQuery.parse(request.query);

    const items = await app.prisma.spendRequest.findMany({
      where: {
        companyId,
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
    const { companyId } = request.requireAuth();
    const found = await app.prisma.spendRequest.findFirst({
      where: { id: request.params.id, companyId },
    });
    if (!found) throw new NotFoundError(`SpendRequest ${request.params.id} not found`);
    return serializeSpendRequest(found, {
      withStellarExpertUrl: true,
      network: env.STELLAR_NETWORK,
    });
  });
};

export default spendRequestsRoute;
