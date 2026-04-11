/**
 * @file agents.ts
 * @package apps/api
 *
 * ═══════════════════════════════════════════════════════════════
 *  AGENTS — REGISTRATION, MANAGEMENT, AND GOVERNANCE CONTROLS
 * ═══════════════════════════════════════════════════════════════
 *
 * An Agent in CommandRail represents a single AI agent instance that has
 * been granted controlled economic autonomy. Every spend request is
 * attributed to exactly one agent.
 *
 * This file handles the full agent lifecycle:
 *   - Registration: create agent, generate API key, link to treasury
 *   - Management: list, view details, update name/owner
 *   - Governance: kill switch, policy assignment, budget configuration
 *   - Observability: audit log, budget status dashboard
 *
 * API key design:
 *   Format: `cr_<40 chars of nanoid>` — prefix makes keys recognizable
 *   in logs and easy to filter/rotate in secret scanners.
 *   Only the SHA-256 hash is stored in the DB (apiKeyHash field).
 *   The raw key is returned ONCE at creation and never again.
 *   If lost → re-register the agent.
 *
 * Kill switch design:
 *   The killSwitchActive flag on Agent is the DB-level enforcement.
 *   When true, the policy engine returns REJECTED for ALL requests,
 *   regardless of amount, vendor, or any other rule (Rule 1, highest priority).
 *   This is the "emergency stop" — instant, no confirmation needed.
 *   Separate from agent_disabled (permanent soft-disable, preserves history).
 *
 * Policy assignment design:
 *   Each agent has at most ONE active policy at a time.
 *   Assigning a new policy automatically deactivates the previous one
 *   (updateMany where active: true → active: false, then create new).
 *   Old policies are preserved in DB for audit history.
 *
 * Routes exposed:
 *   POST   /companies/:companyId/agents          — register agent
 *   GET    /companies/:companyId/agents          — list company agents
 *   GET    /agents/:agentId                      — agent details + spend history
 *   PATCH  /agents/:agentId                      — update name/owner
 *   POST   /agents/:agentId/kill-switch          — toggle kill switch
 *   POST   /agents/:agentId/policies             — assign/replace policy
 *   POST   /companies/:companyId/budgets         — set/update budget
 *   GET    /agents/:agentId/audit-log            — agent's event history
 *   GET    /agents/:agentId/budget-status        — current spend vs. limits
 */

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

/**
 * generateApiKey() — creates a new random API key.
 * Format: cr_<40 nanoid chars> (~238 bits of entropy)
 * The "cr_" prefix makes these easy to identify in logs and secret scanners.
 */
function generateApiKey(): string {
  return `cr_${nanoid(40)}`;
}

/**
 * hashApiKey() — local copy for use at registration time.
 * Matches the implementation in middleware/auth.ts.
 * Both must use the same algorithm for DB lookup to work.
 */
function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export async function agentsRoutes(app: FastifyInstance) {
  // ─── POST /companies/:companyId/agents ────────────────────────────────────
  // Register a new AI agent and link it to a company (and optionally a treasury).
  // Returns the agent record plus the raw API key — this is the ONLY time
  // the full key is visible. The caller must store it securely.
  app.post<{ Params: { companyId: string } }>(
    '/companies/:companyId/agents',
    async (request, reply) => {
      const { companyId } = request.params;
      const body = CreateAgentSchema.parse(request.body);

      const company = await app.prisma.company.findUnique({ where: { id: companyId } });
      if (!company) return reply.notFound('Company not found');

      // If a treasury is specified, verify it belongs to this company
      // (prevents cross-tenant treasury assignment)
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
          apiKeyHash,           // Never stored in plaintext
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

      // Return the raw API key alongside the agent record.
      // This is the ONLY response that includes the plaintext key.
      return reply.status(201).send({ ...agent, apiKey });
    },
  );

  // ─── GET /companies/:companyId/agents ─────────────────────────────────────
  // List all agents for a company. Never exposes apiKeyHash in the response
  // (stripped via destructuring). Includes policy and budget summaries.
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

      // Strip apiKeyHash before returning — it's an internal security field
      return agents.map(({ apiKeyHash: _, ...a }) => a);
    },
  );

  // ─── GET /agents/:agentId ─────────────────────────────────────────────────
  // Full agent details for the dashboard: includes policies, budget, treasury,
  // and last 20 spend requests with Solana Explorer links.
  app.get<{ Params: { agentId: string } }>('/agents/:agentId', async (request, reply) => {
    const agent = await app.prisma.agent.findUnique({
      where: { id: request.params.agentId },
      include: {
        policies: true,
        budgets: true,
        treasury: {
          select: { id: true, name: true, walletAddress: true, status: true, network: true },
        },
        spendRequests: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true, vendor: true, amount: true, currency: true,
            status: true, policyDecision: true, actionType: true,
            txSignature: true, explorerUrl: true, createdAt: true,
          },
        },
        _count: { select: { spendRequests: true } },
      },
    });
    if (!agent) return reply.notFound('Agent not found');

    // Strip apiKeyHash — never expose it in responses
    const { apiKeyHash: _, ...safeAgent } = agent;
    return safeAgent;
  });

  // ─── PATCH /agents/:agentId ───────────────────────────────────────────────
  // Update mutable agent metadata (name, owner).
  // Does NOT allow changing status, killSwitch, or API key via this route —
  // those have dedicated endpoints for auditability.
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

  // ─── POST /agents/:agentId/kill-switch ────────────────────────────────────
  // THE EMERGENCY STOP. Activating the kill switch blocks ALL future spend
  // requests from this agent, regardless of amount, vendor, or policy.
  //
  // This is enforced by Rule 1 in the policy engine (highest priority):
  //   if (agent.killSwitchActive) return reject('kill_switch', ...)
  //
  // Deactivating restores normal policy evaluation.
  //
  // The reason field is recorded in the audit log for compliance.
  // Field name: accepts both "active" and "activate" for dashboard compatibility.
  app.post<{ Params: { agentId: string }; Body: { active?: boolean; activate?: boolean; reason?: string } }>(
    '/agents/:agentId/kill-switch',
    async (request, reply) => {
      const { agentId } = request.params;
      const body = (request.body as { active?: boolean; activate?: boolean; reason?: string }) ?? {};

      // Accept both "active" and "activate" for backwards compatibility with different clients
      const activate = body.active ?? body.activate ?? false;
      const { reason } = body;

      const agent = await app.prisma.agent.findUnique({ where: { id: agentId } });
      if (!agent) return reply.notFound('Agent not found');

      const updated = await app.prisma.agent.update({
        where: { id: agentId },
        data: { killSwitchActive: activate },
      });

      // Always audit kill switch changes — both activation and deactivation
      await createAuditLog({
        prisma: app.prisma,
        companyId: agent.companyId,
        agentId,
        eventType: activate
          ? AuditEventType.KILL_SWITCH_ACTIVATED
          : AuditEventType.KILL_SWITCH_DEACTIVATED,
        actorType: ActorType.ADMIN,
        actorId: 'admin',
        payload: { reason: reason ?? null, previousState: agent.killSwitchActive },
      });

      const { apiKeyHash: _, ...safeAgent } = updated;
      return safeAgent;
    },
  );

  // ─── POST /agents/:agentId/policies ──────────────────────────────────────
  // Assign a new policy to an agent, replacing the previously active one.
  // The old policy is preserved in the DB but marked inactive.
  //
  // Policy rules (stored as JSON) control:
  //   - maxTransactionAmount: hard ceiling per transaction
  //   - requireApprovalAbove: escalation threshold
  //   - vendorAllowList / vendorDenyList: vendor governance
  //   - allowedActionTypes: what categories of spend are permitted
  //
  // See PolicyRules type in packages/shared/src/types.ts for the full schema.
  app.post<{ Params: { agentId: string } }>('/agents/:agentId/policies', async (request, reply) => {
    const { agentId } = request.params;
    const body = AssignPolicySchema.parse(request.body);

    const agent = await app.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return reply.notFound('Agent not found');

    // Deactivate all currently active policies before creating the new one
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

  // ─── POST /companies/:companyId/budgets ───────────────────────────────────
  // Set or update spending limits for an agent.
  // Budget is separate from policy because budgets change more frequently
  // (monthly resets, business reviews) than policy rules (governance decisions).
  //
  // Budget limits enforced by the policy engine:
  //   - perTransactionLimit: hard ceiling per individual transaction
  //   - dailyLimit: rolling 24h aggregate spend ceiling
  //   - monthlyLimit: rolling 30d aggregate spend ceiling
  //
  // Uses upsert: creating a budget for an agent that already has one
  // updates it in-place (one budget per agent, enforced by @unique on agentId).
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
        payload: {
          budgetId: budget.id,
          dailyLimit: body.dailyLimit,
          monthlyLimit: body.monthlyLimit,
        },
      });

      return reply.status(201).send(budget);
    },
  );

  // ─── GET /agents/:agentId/audit-log ──────────────────────────────────────
  // Returns the last 100 audit events for an agent, newest first.
  // Includes spend decisions, kill switch changes, policy assignments, etc.
  // This is the per-agent view; GET /companies/:id/audit-logs is the full view.
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

  // ─── GET /agents/:agentId/budget-status ───────────────────────────────────
  // Real-time budget utilization for the dashboard.
  // Returns how much the agent has spent today and this month vs. their limits.
  // Only counts EXECUTED requests (policy-approved + confirmed on-chain).
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

      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Parallel queries for daily and monthly aggregates
      const [dailyResult, monthlyResult] = await Promise.all([
        app.prisma.spendRequest.aggregate({
          where: {
            agentId: request.params.agentId,
            status: 'EXECUTED',
            createdAt: { gte: startOfDay },
          },
          _sum: { amount: true },
        }),
        app.prisma.spendRequest.aggregate({
          where: {
            agentId: request.params.agentId,
            status: 'EXECUTED',
            createdAt: { gte: startOfMonth },
          },
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
