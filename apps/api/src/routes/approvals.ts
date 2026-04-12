/**
 * @file approvals.ts
 * @package apps/api
 *
 * ═══════════════════════════════════════════════════════════════
 *  APPROVALS — HUMAN REVIEW QUEUE
 * ═══════════════════════════════════════════════════════════════
 *
 * When the policy engine decides REQUIRES_APPROVAL, the spend request
 * enters a human review queue. This file handles that queue.
 *
 * The approval flow:
 *   1. policy engine returns REQUIRES_APPROVAL (see spend-requests.ts)
 *   2. An ApprovalRequest record is created with status = PENDING
 *   3. It appears in GET /approvals/pending (this file)
 *   4. An admin reviews in the dashboard and calls approve or reject
 *   5. On approve:
 *      - ApprovalRequest.status → APPROVED
 *      - SpendRequest.status → APPROVED (ready to execute)
 *      - Audit log event: APPROVAL_GRANTED
 *   6. On reject:
 *      - ApprovalRequest.status → REJECTED
 *      - SpendRequest.status → REJECTED (terminal, no Solana transfer)
 *      - Audit log event: APPROVAL_DENIED
 *   7. After approval, the dashboard calls POST /spend-requests/:id/execute
 *      to trigger the actual Solana SPL token transfer
 *
 * Atomicity:
 *   The approve and reject operations use Prisma transactions ($transaction)
 *   to update both ApprovalRequest and SpendRequest atomically. If either
 *   write fails, both roll back — we never end up with an approved approval
 *   attached to a still-REQUIRES_APPROVAL spend request.
 *
 * Idempotency:
 *   Both routes check `approval.status !== 'PENDING'` before proceeding.
 *   Double-clicking "approve" in the dashboard returns a 409 Conflict,
 *   not a silent double-write.
 *
 * Routes exposed:
 *   GET  /approvals/pending           — dashboard: show the review queue
 *   POST /approvals/:approvalId/approve — admin approves
 *   POST /approvals/:approvalId/reject  — admin rejects
 */

import type { FastifyInstance } from 'fastify';
import { ApprovalDecisionSchema, AuditEventType, ActorType } from '@aegis/shared';
import { createAuditLog } from '../services/audit.js';
import { notifyApprovalDecision } from '../services/notify.js';

export async function approvalsRoutes(app: FastifyInstance) {
  // ─── GET /approvals/pending ───────────────────────────────────────────────
  // Returns all PENDING approval requests for a company, enriched with the
  // spend request details and the agent that submitted it.
  // The dashboard uses this to render the approval queue with full context.
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
      orderBy: { createdAt: 'desc' }, // Oldest first → urgent requests float up
    });
    return pending;
  });

  // ─── POST /approvals/:approvalId/approve ──────────────────────────────────
  // Admin approves a spend request that required human review.
  // After this, the spend request status becomes APPROVED and the dashboard
  // can trigger POST /spend-requests/:id/execute to run the Solana transfer.
  app.post<{ Params: { approvalId: string } }>('/:approvalId/approve', async (request, reply) => {
    const { approvalId } = request.params;
    // decisionReason is optional — admin can add a note explaining the approval
    const body = ApprovalDecisionSchema.parse(request.body ?? {});

    const approval = await app.prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: {
        spendRequest: {
          include: { agent: { select: { name: true, ownerEmail: true } } },
        },
      },
    });

    if (!approval) return reply.notFound('Approval request not found');

    // Prevent double-processing: 409 if already decided
    if (approval.status !== 'PENDING') return reply.conflict(`Approval already ${approval.status}`);

    // Atomic update: both records change together or neither does
    const [updatedApproval] = await app.prisma.$transaction([
      app.prisma.approvalRequest.update({
        where: { id: approvalId },
        data: {
          status: 'APPROVED',
          decisionReason: body.decisionReason ?? null,
          decidedAt: new Date(),
        },
      }),
      // SpendRequest must be APPROVED for /execute to proceed
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

    // Notify agent owner of approval decision (non-blocking, silent on failure)
    if (approval.spendRequest.agent.ownerEmail) {
      void notifyApprovalDecision({
        toEmail: approval.spendRequest.agent.ownerEmail,
        agentName: approval.spendRequest.agent.name,
        vendor: approval.spendRequest.vendor,
        amount: Number(approval.spendRequest.amount),
        decision: 'approved',
        decisionReason: body.decisionReason ?? null,
        requestId: approval.spendRequestId,
      });
    }

    return updatedApproval;
  });

  // ─── POST /approvals/:approvalId/reject ───────────────────────────────────
  // Admin rejects a spend request that required human review.
  // This is a terminal state — the request cannot be re-approved or executed.
  // The AI agent will see status = REJECTED when it polls /spend-requests/:id.
  app.post<{ Params: { approvalId: string } }>('/:approvalId/reject', async (request, reply) => {
    const { approvalId } = request.params;
    const body = ApprovalDecisionSchema.parse(request.body ?? {});

    const approval = await app.prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: {
        spendRequest: {
          include: { agent: { select: { name: true, ownerEmail: true } } },
        },
      },
    });

    if (!approval) return reply.notFound('Approval request not found');
    if (approval.status !== 'PENDING') return reply.conflict(`Approval already ${approval.status}`);

    // Atomic: both records updated or neither
    const [updatedApproval] = await app.prisma.$transaction([
      app.prisma.approvalRequest.update({
        where: { id: approvalId },
        data: {
          status: 'REJECTED',
          decisionReason: body.decisionReason ?? null,
          decidedAt: new Date(),
        },
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

    // Notify agent owner of rejection (non-blocking)
    if (approval.spendRequest.agent.ownerEmail) {
      void notifyApprovalDecision({
        toEmail: approval.spendRequest.agent.ownerEmail,
        agentName: approval.spendRequest.agent.name,
        vendor: approval.spendRequest.vendor,
        amount: Number(approval.spendRequest.amount),
        decision: 'rejected',
        decisionReason: body.decisionReason ?? null,
        requestId: approval.spendRequestId,
      });
    }

    return updatedApproval;
  });
}
