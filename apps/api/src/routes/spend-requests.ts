import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { CreateSpendRequestSchema, AuditEventType, ActorType, AgentStatus, Currency, PolicyDecision } from '@command-rail/shared';
import { evaluate } from '@command-rail/policy-engine';
import { TreasuryService } from '@command-rail/solana';
import { hashApiKey } from '../middleware/auth.js';
import { createAuditLog } from '../services/audit.js';

export async function spendRequestsRoutes(app: FastifyInstance) {
  // POST /spend-requests — agent submits a spend request
  app.post('/', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.unauthorized('Missing API key');
    const apiKey = authHeader.slice(7);
    const keyHash = hashApiKey(apiKey);

    const agent = await app.prisma.agent.findUnique({
      where: { apiKeyHash: keyHash },
      include: {
        policies: { where: { active: true }, take: 1 },
        budgets: { where: { active: true }, take: 1 },
        company: true,
        treasury: true,
      },
    });

    if (!agent) return reply.unauthorized('Invalid API key');

    const body = CreateSpendRequestSchema.parse(request.body);

    // Compute budget usage
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [dailyResult, monthlyResult] = await Promise.all([
      app.prisma.spendRequest.aggregate({
        where: { agentId: agent.id, status: 'EXECUTED', createdAt: { gte: startOfDay } },
        _sum: { amount: true },
      }),
      app.prisma.spendRequest.aggregate({
        where: { agentId: agent.id, status: 'EXECUTED', createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
    ]);

    const budget = agent.budgets[0];
    const policy = agent.policies[0];

    const evaluationResult = evaluate({
      spendRequest: {
        amount: body.amount,
        vendor: body.vendor,
        actionType: body.actionType,
        currency: body.currency as Currency,
      },
      agent: {
        status: agent.status as AgentStatus,
        killSwitchActive: agent.killSwitchActive,
      },
      policy: policy ? (policy.rules as object) : {},
      budget: {
        perTransactionLimit: budget ? Number(budget.perTransactionLimit) : 0,
        dailyLimit: budget ? Number(budget.dailyLimit) : 0,
        monthlyLimit: budget ? Number(budget.monthlyLimit) : 0,
        dailySpent: Number(dailyResult._sum.amount ?? 0),
        monthlySpent: Number(monthlyResult._sum.amount ?? 0),
      },
    });

    const initialStatus =
      evaluationResult.decision === PolicyDecision.APPROVED
        ? 'APPROVED'
        : evaluationResult.decision === PolicyDecision.REQUIRES_APPROVAL
          ? 'REQUIRES_APPROVAL'
          : 'REJECTED';

    const spendRequest = await app.prisma.spendRequest.create({
      data: {
        companyId: agent.companyId,
        agentId: agent.id,
        actionType: body.actionType,
        vendor: body.vendor,
        amount: body.amount,
        currency: body.currency,
        reason: body.reason,
        reference: body.reference ?? null,
        status: initialStatus,
        policyDecision: evaluationResult.decision,
        decisionReason: evaluationResult.reason,
        matchedRule: evaluationResult.matchedRule,
        metadata: body.metadata as Prisma.InputJsonValue,
      },
    });

    // Create approval request if needed
    if (evaluationResult.decision === PolicyDecision.REQUIRES_APPROVAL) {
      await app.prisma.approvalRequest.create({
        data: { spendRequestId: spendRequest.id, status: 'PENDING' },
      });

      await createAuditLog({
        prisma: app.prisma,
        companyId: agent.companyId,
        agentId: agent.id,
        spendRequestId: spendRequest.id,
        eventType: AuditEventType.SPEND_REQUEST_REQUIRES_APPROVAL,
        actorType: ActorType.SYSTEM,
        actorId: 'policy-engine',
        payload: { matchedRule: evaluationResult.matchedRule, reason: evaluationResult.reason },
      });
    } else {
      const eventType =
        evaluationResult.decision === PolicyDecision.APPROVED
          ? AuditEventType.SPEND_REQUEST_APPROVED
          : AuditEventType.SPEND_REQUEST_REJECTED;

      await createAuditLog({
        prisma: app.prisma,
        companyId: agent.companyId,
        agentId: agent.id,
        spendRequestId: spendRequest.id,
        eventType,
        actorType: ActorType.SYSTEM,
        actorId: 'policy-engine',
        payload: { matchedRule: evaluationResult.matchedRule, reason: evaluationResult.reason },
      });
    }

    await createAuditLog({
      prisma: app.prisma,
      companyId: agent.companyId,
      agentId: agent.id,
      spendRequestId: spendRequest.id,
      eventType: AuditEventType.SPEND_REQUEST_SUBMITTED,
      actorType: ActorType.AGENT,
      actorId: agent.id,
      payload: { amount: body.amount, vendor: body.vendor, actionType: body.actionType },
    });

    return reply.status(201).send(spendRequest);
  });

  // GET /spend-requests/:requestId
  app.get<{ Params: { requestId: string } }>('/:requestId', async (request, reply) => {
    const spendRequest = await app.prisma.spendRequest.findUnique({
      where: { id: request.params.requestId },
      include: { approvalRequest: true },
    });
    if (!spendRequest) return reply.notFound('Spend request not found');
    return spendRequest;
  });

  // POST /spend-requests/:requestId/execute — execute an approved request on-chain
  app.post<{ Params: { requestId: string } }>('/:requestId/execute', async (request, reply) => {
    const spendRequest = await app.prisma.spendRequest.findUnique({
      where: { id: request.params.requestId },
      include: {
        agent: { include: { treasury: true } },
        approvalRequest: true,
      },
    });

    if (!spendRequest) return reply.notFound('Spend request not found');

    if (spendRequest.status !== 'APPROVED') {
      return reply.badRequest(`Cannot execute request with status ${spendRequest.status}`);
    }

    const treasury = spendRequest.agent.treasury;
    if (!treasury) return reply.badRequest('Agent has no treasury configured');
    if (treasury.status === 'FROZEN') return reply.badRequest('Treasury is frozen');

    try {
      const treasuryService = new TreasuryService(treasury.network as 'devnet' | 'mainnet-beta');

      // For demo: transfer to a placeholder vendor wallet (in production, vendor would have a registered wallet)
      const vendorWallet = treasury.walletAddress; // Placeholder — self-transfer for demo
      const result = await treasuryService.transferUsdc(
        treasury.encryptedSecret,
        vendorWallet,
        Number(spendRequest.amount),
      );

      const updated = await app.prisma.spendRequest.update({
        where: { id: spendRequest.id },
        data: {
          status: 'EXECUTED',
          txSignature: result.signature,
          explorerUrl: result.explorerUrl,
        },
      });

      await createAuditLog({
        prisma: app.prisma,
        companyId: spendRequest.companyId,
        agentId: spendRequest.agentId,
        spendRequestId: spendRequest.id,
        eventType: AuditEventType.SPEND_REQUEST_EXECUTED,
        actorType: ActorType.SYSTEM,
        actorId: 'treasury',
        payload: { txSignature: result.signature, explorerUrl: result.explorerUrl, amount: spendRequest.amount },
      });

      return updated;
    } catch (err) {
      await app.prisma.spendRequest.update({
        where: { id: spendRequest.id },
        data: { status: 'FAILED' },
      });

      await createAuditLog({
        prisma: app.prisma,
        companyId: spendRequest.companyId,
        agentId: spendRequest.agentId,
        spendRequestId: spendRequest.id,
        eventType: AuditEventType.SPEND_REQUEST_FAILED,
        actorType: ActorType.SYSTEM,
        actorId: 'treasury',
        payload: { error: String(err) },
      });

      return reply.internalServerError(`Execution failed: ${String(err)}`);
    }
  });

  // GET /spend-requests (company-scoped, admin)
  app.get<{ Querystring: { companyId: string; status?: string; limit?: string } }>(
    '/',
    async (request, reply) => {
      const { companyId, status, limit } = request.query;
      if (!companyId) return reply.badRequest('companyId is required');

      const requests = await app.prisma.spendRequest.findMany({
        where: { companyId, ...(status ? { status: status as 'PENDING' } : {}) },
        include: { agent: { select: { id: true, name: true, type: true } }, approvalRequest: true },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(limit ?? 50), 200),
      });
      return requests;
    },
  );
}
