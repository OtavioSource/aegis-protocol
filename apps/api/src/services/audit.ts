import type { PrismaClient, Prisma } from '@prisma/client';
import { AuditEventType, ActorType } from '@command-rail/shared';

type CreateAuditLogParams = {
  prisma: PrismaClient;
  companyId: string;
  eventType: AuditEventType;
  actorType: ActorType;
  actorId: string;
  agentId?: string;
  spendRequestId?: string;
  payload?: Prisma.InputJsonValue;
};

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
