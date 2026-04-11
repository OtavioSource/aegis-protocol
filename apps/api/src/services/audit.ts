/**
 * @file audit.ts
 * @package apps/api
 *
 * ═══════════════════════════════════════════════════════════════
 *  AUDIT LOG SERVICE — IMMUTABLE EVENT TRAIL
 * ═══════════════════════════════════════════════════════════════
 *
 * Every governance decision in CommandRail is recorded here.
 * The audit log is the trust layer — it lets operators answer:
 *
 *   "Who approved this spend? When? What policy matched?"
 *   "When was the kill switch activated and why?"
 *   "Which Solana transaction corresponds to this spend request?"
 *
 * Design principles:
 *
 *   1. APPEND-ONLY — audit logs are never updated or deleted.
 *      The DB has no UPDATE on audit_logs anywhere in the codebase.
 *      Historical events must remain intact for compliance.
 *
 *   2. CALLED AFTER EVERY STATE CHANGE — every route that changes
 *      system state (approve, reject, execute, kill switch, policy
 *      assignment) must call createAuditLog() immediately after.
 *
 *   3. PAYLOAD IS FREEFORM JSON — the `payload` field captures
 *      context specific to each event type (matched rule, tx signature,
 *      decision reason, previous state, etc.). This avoids schema
 *      migration every time a new event type is added.
 *
 *   4. ACTOR TYPES distinguish who triggered the event:
 *      - AGENT: the AI agent submitted the request
 *      - SYSTEM: the policy engine made an automated decision
 *      - ADMIN: a human (admin dashboard) changed something
 *      - APPROVER: a human approved/rejected from the approval queue
 *
 * Event types (see AuditEventType enum in packages/shared/src/enums.ts):
 *   Agent lifecycle:  AGENT_REGISTERED, KILL_SWITCH_ACTIVATED/DEACTIVATED
 *   Spend lifecycle:  SPEND_REQUEST_SUBMITTED → APPROVED/REJECTED/REQUIRES_APPROVAL → EXECUTED
 *   Approval:         APPROVAL_GRANTED, APPROVAL_DENIED
 *   Admin setup:      POLICY_ASSIGNED, BUDGET_CREATED, TREASURY_CREATED, TREASURY_FUNDED
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import { AuditEventType, ActorType } from '@command-rail/shared';

type CreateAuditLogParams = {
  prisma: PrismaClient;
  companyId: string;
  eventType: AuditEventType;
  actorType: ActorType;
  /** The ID of whoever triggered this event (agent ID, 'admin', 'policy-engine', 'treasury') */
  actorId: string;
  /** Optional: which agent this event is about (may differ from actorId for SYSTEM events) */
  agentId?: string;
  /** Optional: which spend request triggered this event */
  spendRequestId?: string;
  /** Event-specific context: matched rule, tx signature, decision reason, etc. */
  payload?: Prisma.InputJsonValue;
};

/**
 * createAuditLog() — append a single event to the immutable audit trail.
 *
 * This function is deliberately thin — it's a direct DB write with no
 * business logic. Callers (route handlers) are responsible for passing
 * the correct eventType and payload for each situation.
 *
 * The function never throws silently — if the DB write fails, the error
 * propagates to the route handler, which returns a 500 to the caller.
 * We intentionally don't swallow audit failures: a system that can't
 * record what it did is a system that can't be trusted.
 *
 * @example
 * await createAuditLog({
 *   prisma: app.prisma,
 *   companyId: agent.companyId,
 *   agentId: agent.id,
 *   spendRequestId: spendRequest.id,
 *   eventType: AuditEventType.SPEND_REQUEST_EXECUTED,
 *   actorType: ActorType.SYSTEM,
 *   actorId: 'treasury',
 *   payload: { txSignature: result.signature, explorerUrl: result.explorerUrl },
 * });
 */
export async function createAuditLog({
  prisma,
  companyId,
  eventType,
  actorType,
  actorId,
  agentId,
  spendRequestId,
  payload = {} as Prisma.InputJsonValue,
}: CreateAuditLogParams) {
  return prisma.auditLog.create({
    data: {
      companyId,
      agentId: agentId ?? null,
      spendRequestId: spendRequestId ?? null,
      eventType,
      actorType,
      actorId,
      payload,
    },
  });
}
