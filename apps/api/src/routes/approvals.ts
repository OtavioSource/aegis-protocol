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
      const caller = request.requireAgent();
      const body = ApprovalBody.parse(request.body);

      const sr = await app.prisma.spendRequest.findFirst({
        where: {
          id: request.params.spendRequestId,
          companyId: caller.companyId,
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
            // No MVP, a Approval referencia o Agent caller via userId placeholder.
            // Quando o NextAuth chegar (iter 10), userId vira o User real (UUID v4).
            // Aqui evitamos quebrar a FK omitindo userId não seria possível pois é NOT NULL,
            // então criamos uma referência ao "primeiro user OWNER da Company" como fallback.
            userId: await resolveApproverUserId(app, caller.companyId),
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
            companyId: caller.companyId,
            spendRequestId: sr.id,
            eventType,
            actor: `agent:${caller.id}`,
            payload: {
              action: body.action,
              reason: body.reason ?? null,
              previousStatus: sr.status,
              newStatus,
            } as object,
          },
        }),
      ]);

      return {
        spendRequest: serializeSpendRequest(updated, {
          withStellarExpertUrl: true,
          network: env.STELLAR_NETWORK,
        }),
      };
    },
  );

  // ----- GET /v1/approvals/pending -----
  app.get('/v1/approvals/pending', async (request) => {
    const caller = request.requireAgent();
    const items = await app.prisma.spendRequest.findMany({
      where: {
        companyId: caller.companyId,
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
