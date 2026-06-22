/**
 * Rotas de Approval (decisão humana sobre SpendRequest escalada).
 *
 * - POST /v1/approvals/:spendRequestId  (action APPROVE | REJECT)
 * - GET  /v1/approvals/pending          (fila de pending para a Company)
 *
 * IMPORTANTE (MVP): no momento, qualquer Agent autenticado pode aprovar.
 * RBAC com Users OWNER/ADMIN entra na iteração 10 (NextAuth + dashboard).
 */

import { ApprovalAction, EventType, SpendRequestStatus } from '@prisma/client';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { env } from '../env.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { prepareSpendRequestEnvelope } from '../services/multisig-payment.js';
import { serializeSpendRequest } from '../services/spend-request.js';

const ApprovalBody = z.object({
  action: z.nativeEnum(ApprovalAction),
  reason: z.string().max(500).optional(),
});

const approvalsRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ----- POST /v1/approvals/:spendRequestId -----
  app.post<{ Params: { spendRequestId: string } }>(
    '/v1/approvals/:spendRequestId',
    async (request) => {
      const { companyId } = request.requireAuth();
      const body = ApprovalBody.parse(request.body);

      // Aprovador + actor: o User logado (dashboard) quando presente; senão,
      // fallback ao primeiro OWNER da Company (caller é agente, sem User direto).
      const approverUserId = request.user?.sub ?? (await resolveApproverUserId(app, companyId));
      const actor = request.user
        ? `user:${request.user.sub}`
        : `agent:${request.agent?.id ?? 'system'}`;

      const sr = await app.prisma.spendRequest.findFirst({
        where: {
          id: request.params.spendRequestId,
          companyId,
        },
      });
      if (!sr) {
        throw new NotFoundError(`SpendRequest ${request.params.spendRequestId} not found`);
      }
      if (sr.status !== SpendRequestStatus.REQUIRES_APPROVAL) {
        throw new ConflictError(
          `SpendRequest ${sr.id} is in status ${sr.status}; only REQUIRES_APPROVAL can be approved/rejected.`,
        );
      }

      // Determinar novo status
      const newStatus =
        body.action === ApprovalAction.APPROVED
          ? SpendRequestStatus.APPROVED_BY_HUMAN
          : SpendRequestStatus.REJECTED_BY_HUMAN;

      const eventType =
        body.action === ApprovalAction.APPROVED
          ? EventType.APPROVAL_GRANTED
          : EventType.APPROVAL_DENIED;

      const [, updated] = await app.prisma.$transaction([
        app.prisma.approval.create({
          data: {
            spendRequestId: sr.id,
            // Aprovador: User logado (dashboard) quando há sessão; senão fallback
            // ao primeiro OWNER da Company (caller via agente).
            userId: approverUserId,
            action: body.action,
            reason: body.reason ?? null,
          },
        }),
        app.prisma.spendRequest.update({
          where: { id: sr.id },
          data: { status: newStatus },
        }),
        app.prisma.auditEvent.create({
          data: {
            companyId,
            spendRequestId: sr.id,
            eventType,
            actor,
            payload: {
              action: body.action,
              reason: body.reason ?? null,
              previousStatus: sr.status,
              newStatus,
            } as object,
          },
        }),
      ]);

      // Não-custodial (5a): aprovação humana NÃO liquida sozinha. Constrói o
      // envelope canônico e transiciona para AWAITING_AGENT_SIGNATURE; o agente
      // assina e chama POST /v1/spend-requests/:id/cosign.
      if (body.action === ApprovalAction.APPROVED) {
        await prepareSpendRequestEnvelope(app, sr.id);
      }

      // Re-lê para refletir envelope/status pós-preparo
      const final = await app.prisma.spendRequest.findUnique({ where: { id: sr.id } });
      return {
        spendRequest: serializeSpendRequest(final ?? updated, {
          withStellarExpertUrl: true,
          network: env.STELLAR_NETWORK,
        }),
      };
    },
  );

  // ----- GET /v1/approvals/pending -----
  app.get('/v1/approvals/pending', async (request) => {
    const { companyId } = request.requireAuth();
    const items = await app.prisma.spendRequest.findMany({
      where: {
        companyId,
        status: SpendRequestStatus.REQUIRES_APPROVAL,
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return {
      data: items.map((i) =>
        serializeSpendRequest(i, { withStellarExpertUrl: true, network: env.STELLAR_NETWORK }),
      ),
    };
  });
};

/**
 * Resolve um userId válido para a FK de Approval no MVP. Como Agent
 * autenticado não tem User direto (RBAC humano vem na iter 10), usamos o
 * primeiro User OWNER da Company como aprovador "system" temporário.
 */
async function resolveApproverUserId(
  app: FastifyInstance,
  companyId: string,
): Promise<string> {
  const owner = await app.prisma.user.findFirst({
    where: { companyId, role: 'OWNER' },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) {
    throw new ConflictError(
      `No OWNER user found for Company ${companyId}. Cannot create Approval without an approver.`,
    );
  }
  return owner.id;
}

export default approvalsRoute;
