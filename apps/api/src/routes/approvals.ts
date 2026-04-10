import type { FastifyInstance } from 'fastify';
import { ApprovalDecisionSchema, AuditEventType, ActorType } from '@command-rail/shared';
import { createAuditLog } from '../services/audit.js';

export async function approvalsRoutes(app: FastifyInstance) {
  // GET /approvals/pending
  app.get<{ Querystring: { companyId: string } }>('/pending', async (request, reply) => {
    const { companyId } = request.query;
    if (!companyId) return reply.badRequest('companyId is required');

    const pending = await app.prisma.approvalRequest.findMany({
      where: { status: 'PENDING', spendRequest: { companyId } },
      include: {
        spendRequest: {
          include: { agent: { select: { id: true, name: true, type: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return pending;
  });

  // POST /approvals/:approvalId/approve
  app.post<{ Params: { approvalId: string } }>('/:approvalId/approve', async (request, reply) => {
    const { approvalId } = request.params;
    const body = ApprovalDecisionSchema.parse(request.body ?? {});

    const approval = await app.prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: { spendRequest: true },
    });

    if (!approval) return reply.notFound('Approval request not found');
    if (approval.status !== 'PENDING') return reply.conflict(`Approval already ${approval.status}`);

    const [updatedApproval] = await app.prisma.$transaction([
      app.prisma.approvalRequest.update({
        where: { id: approvalId },
        data: { status: 'APPROVED', decisionReason: body.decisionReason ?? null, decidedAt: new Date() },
      }),
      app.prisma.spendRequest.update({
        where: { id: approval.spendRequestId },
        data: { status: 'APPROVED' },
      }),
    ]);

    await createAuditLog({
      prisma: app.prisma,
      companyId: approval.spendRequest.companyId,
      agentId: approval.spendRequest.agentId,
      spendRequestId: approval.spendRequestId,
      eventType: AuditEventType.APPROVAL_GRANTED,
      actorType: ActorType.APPROVER,
      actorId: 'admin',
      payload: { decisionReason: body.decisionReason ?? null },
    });

    return updatedApproval;
  });

  // POST /approvals/:approvalId/reject
  app.post<{ Params: { approvalId: string } }>('/:approvalId/reject', async (request, reply) => {
    const { approvalId } = request.params;
    const body = ApprovalDecisionSchema.parse(request.body ?? {});

    const approval = await app.prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: { spendRequest: true },
    });

    if (!approval) return reply.notFound('Approval request not found');
    if (approval.status !== 'PENDING') return reply.conflict(`Approval already ${approval.status}`);

    const [updatedApproval] = await app.prisma.$transaction([
      app.prisma.approvalRequest.update({
        where: { id: approvalId },
        data: { status: 'REJECTED', decisionReason: body.decisionReason ?? null, decidedAt: new Date() },
      }),
      app.prisma.spendRequest.update({
        where: { id: approval.spendRequestId },
        data: { status: 'REJECTED' },
      }),
    ]);

    await createAuditLog({
      prisma: app.prisma,
      companyId: approval.spendRequest.companyId,
      agentId: approval.spendRequest.agentId,
      spendRequestId: approval.spendRequestId,
      eventType: AuditEventType.APPROVAL_DENIED,
      actorType: ActorType.APPROVER,
      actorId: 'admin',
      payload: { decisionReason: body.decisionReason ?? null },
    });

    return updatedApproval;
  });
}
