import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { createHash } from 'crypto';
import {
  CreateAgentSchema,
  UpdateAgentSchema,
  AssignPolicySchema,
  CreateBudgetSchema,
  AuditEventType,
  ActorType,
} from '@command-rail/shared';
import { createAuditLog } from '../services/audit.js';

function generateApiKey(): string {
  return `cr_${nanoid(40)}`;
}

function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export async function agentsRoutes(app: FastifyInstance) {
  // POST /companies/:companyId/agents
  app.post<{ Params: { companyId: string } }>(
    '/companies/:companyId/agents',
    async (request, reply) => {
      const { companyId } = request.params;
      const body = CreateAgentSchema.parse(request.body);

      const company = await app.prisma.company.findUnique({ where: { id: companyId } });
      if (!company) return reply.notFound('Company not found');

      if (body.treasuryId) {
        const treasury = await app.prisma.treasury.findUnique({
          where: { id: body.treasuryId, companyId },
        });
        if (!treasury) return reply.badRequest('Treasury not found or does not belong to company');
      }

      const apiKey = generateApiKey();
      const apiKeyHash = hashApiKey(apiKey);

      const agent = await app.prisma.agent.create({
        data: {
          companyId,
          name: body.name,
          type: body.type,
          externalAgentId: body.externalAgentId ?? null,
          ownerName: body.ownerName ?? null,
          ownerEmail: body.ownerEmail ?? null,
          treasuryId: body.treasuryId ?? null,
          apiKeyHash,
          status: 'ACTIVE',
          killSwitchActive: false,
        },
      });

      await createAuditLog({
        prisma: app.prisma,
        companyId,
        agentId: agent.id,
        eventType: AuditEventType.AGENT_REGISTERED,
        actorType: ActorType.ADMIN,
        actorId: 'admin',
        payload: { agentName: agent.name, agentType: agent.type },
      });

      return reply.status(201).send({ ...agent, apiKey });
    },
  );

  // GET /companies/:companyId/agents
  app.get<{ Params: { companyId: string } }>(
    '/companies/:companyId/agents',
    async (request, reply) => {
      const company = await app.prisma.company.findUnique({
        where: { id: request.params.companyId },
      });
      if (!company) return reply.notFound('Company not found');

      const agents = await app.prisma.agent.findMany({
        where: { companyId: request.params.companyId },
        include: { policies: true, budgets: true, _count: { select: { spendRequests: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return agents.map(({ apiKeyHash: _, ...a }) => a);
    },
  );

  // GET /agents/:agentId
  app.get<{ Params: { agentId: string } }>('/agents/:agentId', async (request, reply) => {
    const agent = await app.prisma.agent.findUnique({
      where: { id: request.params.agentId },
      include: {
        policies: true,
        budgets: true,
        treasury: { select: { id: true, name: true, walletAddress: true, status: true, network: true } },
        spendRequests: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, vendor: true, amount: true, currency: true, status: true, policyDecision: true, actionType: true, txSignature: true, explorerUrl: true, createdAt: true } },
        _count: { select: { spendRequests: true } },
      },
    });
    if (!agent) return reply.notFound('Agent not found');
    const { apiKeyHash: _, ...safeAgent } = agent;
    return safeAgent;
  });

  // PATCH /agents/:agentId
  app.patch<{ Params: { agentId: string } }>('/agents/:agentId', async (request, reply) => {
    const body = UpdateAgentSchema.parse(request.body);
    const agent = await app.prisma.agent.findUnique({ where: { id: request.params.agentId } });
    if (!agent) return reply.notFound('Agent not found');

    const updated = await app.prisma.agent.update({
      where: { id: request.params.agentId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.ownerName !== undefined ? { ownerName: body.ownerName } : {}),
        ...(body.ownerEmail !== undefined ? { ownerEmail: body.ownerEmail } : {}),
      },
    });
    const { apiKeyHash: _, ...safeAgent } = updated;
    return safeAgent;
  });

  // POST /agents/:agentId/kill-switch
  app.post<{ Params: { agentId: string }; Body: { active?: boolean; activate?: boolean; reason?: string } }>(
    '/agents/:agentId/kill-switch',
    async (request, reply) => {
      const { agentId } = request.params;
      const body = (request.body as { active?: boolean; activate?: boolean; reason?: string }) ?? {};
      // Accept both "active" and "activate" for compatibility
      const activate = body.active ?? body.activate ?? false;
      const { reason } = body;

      const agent = await app.prisma.agent.findUnique({ where: { id: agentId } });
      if (!agent) return reply.notFound('Agent not found');

      const updated = await app.prisma.agent.update({
        where: { id: agentId },
        data: { killSwitchActive: activate },
      });

      await createAuditLog({
        prisma: app.prisma,
        companyId: agent.companyId,
        agentId,
        eventType: activate ? AuditEventType.KILL_SWITCH_ACTIVATED : AuditEventType.KILL_SWITCH_DEACTIVATED,
        actorType: ActorType.ADMIN,
        actorId: 'admin',
        payload: { reason: reason ?? null, previousState: agent.killSwitchActive },
      });

      const { apiKeyHash: _, ...safeAgent } = updated;
      return safeAgent;
    },
  );

  // POST /agents/:agentId/policies
  app.post<{ Params: { agentId: string } }>('/agents/:agentId/policies', async (request, reply) => {
    const { agentId } = request.params;
    const body = AssignPolicySchema.parse(request.body);

    const agent = await app.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return reply.notFound('Agent not found');

    // Deactivate previous active policies
    await app.prisma.policy.updateMany({ where: { agentId, active: true }, data: { active: false } });

    const policy = await app.prisma.policy.create({
      data: { agentId, name: body.name, rules: body.rules, active: true },
    });

    await createAuditLog({
      prisma: app.prisma,
      companyId: agent.companyId,
      agentId,
      eventType: AuditEventType.POLICY_ASSIGNED,
      actorType: ActorType.ADMIN,
      actorId: 'admin',
      payload: { policyId: policy.id, policyName: body.name, rules: body.rules },
    });

    return reply.status(201).send(policy);
  });

  // POST /companies/:companyId/budgets
  app.post<{ Params: { companyId: string } }>(
    '/companies/:companyId/budgets',
    async (request, reply) => {
      const { companyId } = request.params;
      const body = CreateBudgetSchema.parse(request.body);

      const company = await app.prisma.company.findUnique({ where: { id: companyId } });
      if (!company) return reply.notFound('Company not found');

      const agent = await app.prisma.agent.findUnique({
        where: { id: body.agentId, companyId },
      });
      if (!agent) return reply.badRequest('Agent not found or does not belong to company');

      const budget = await app.prisma.budget.upsert({
        where: { agentId: body.agentId },
        create: {
          companyId,
          agentId: body.agentId,
          dailyLimit: body.dailyLimit,
          monthlyLimit: body.monthlyLimit,
          perTransactionLimit: body.perTransactionLimit,
          currency: body.currency,
        },
        update: {
          dailyLimit: body.dailyLimit,
          monthlyLimit: body.monthlyLimit,
          perTransactionLimit: body.perTransactionLimit,
          currency: body.currency,
        },
      });

      await createAuditLog({
        prisma: app.prisma,
        companyId,
        agentId: body.agentId,
        eventType: AuditEventType.BUDGET_CREATED,
        actorType: ActorType.ADMIN,
        actorId: 'admin',
        payload: { budgetId: budget.id, dailyLimit: body.dailyLimit, monthlyLimit: body.monthlyLimit },
      });

      return reply.status(201).send(budget);
    },
  );

  // GET /agents/:agentId/audit-log
  app.get<{ Params: { agentId: string } }>(
    '/agents/:agentId/audit-log',
    async (request, reply) => {
      const agent = await app.prisma.agent.findUnique({ where: { id: request.params.agentId } });
      if (!agent) return reply.notFound('Agent not found');

      const logs = await app.prisma.auditLog.findMany({
        where: { agentId: request.params.agentId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return logs;
    },
  );

  // GET /agents/:agentId/budget-status
  app.get<{ Params: { agentId: string } }>(
    '/agents/:agentId/budget-status',
    async (request, reply) => {
      const agent = await app.prisma.agent.findUnique({
        where: { id: request.params.agentId },
        include: { budgets: true },
      });
      if (!agent) return reply.notFound('Agent not found');

      const budget = agent.budgets[0];
      if (!budget) return reply.notFound('No budget assigned to agent');

      // Calculate daily and monthly spent
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [dailyResult, monthlyResult] = await Promise.all([
        app.prisma.spendRequest.aggregate({
          where: { agentId: request.params.agentId, status: 'EXECUTED', createdAt: { gte: startOfDay } },
          _sum: { amount: true },
        }),
        app.prisma.spendRequest.aggregate({
          where: { agentId: request.params.agentId, status: 'EXECUTED', createdAt: { gte: startOfMonth } },
          _sum: { amount: true },
        }),
      ]);

      return {
        dailySpent: Number(dailyResult._sum.amount ?? 0),
        dailyLimit: Number(budget.dailyLimit),
        monthlySpent: Number(monthlyResult._sum.amount ?? 0),
        monthlyLimit: Number(budget.monthlyLimit),
        perTransactionLimit: Number(budget.perTransactionLimit),
        currency: budget.currency,
      };
    },
  );
}
