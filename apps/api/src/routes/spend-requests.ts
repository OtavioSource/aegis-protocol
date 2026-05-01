/**
 * @file spend-requests.ts
 * @package apps/api
 *
 * ═══════════════════════════════════════════════════════════════
 *  SPEND REQUESTS — THE CENTRAL GOVERNANCE ROUTE
 * ═══════════════════════════════════════════════════════════════
 *
 * This is the most important route file. It orchestrates the core loop:
 *
 *   Agent submits spend request
 *     → API fetches agent + policy + budget from DB
 *     → Calls evaluate() from policy-engine (pure, no I/O)
 *     → Persists SpendRequest with decision
 *     → If REQUIRES_APPROVAL: creates ApprovalRequest for human review
 *     → If APPROVED (via /execute): triggers Solana SPL transfer
 *     → Logs all events to audit trail
 *
 * Routes exposed:
 *   POST /spend-requests              — agent submits a new spend request
 *   GET  /spend-requests/:requestId   — check status + tx signature
 *   POST /spend-requests/:requestId/execute — trigger Solana transfer (APPROVED only)
 *   GET  /spend-requests              — admin list (company-scoped)
 *
 * Key design decisions:
 *
 *   1. AUTHENTICATION is done inline (not via preHandler) because we need
 *      the agent+policy+budget in the same query. A preHandler would require
 *      a second DB round-trip.
 *
 *   2. BUDGET COMPUTATION is done here, not in the policy engine.
 *      The policy engine is pure and receives pre-computed dailySpent /
 *      monthlySpent. The API is responsible for fetching those aggregates
 *      from the DB. This keeps evaluate() free of I/O.
 *
 *   3. THE EXECUTE STEP is separate from the submit step intentionally.
 *      This allows the dashboard to show APPROVED requests before they're
 *      executed, and allows manual or delayed execution in production scenarios.
 *      For REQUIRES_APPROVAL, execute is called after human approval
 *      (see approvals.ts which updates status to APPROVED, then calls /execute).
 *
 *   4. FAILED TRANSFERS are tracked: if Solana execution fails, we mark
 *      the SpendRequest as FAILED (not REJECTED) so operators can distinguish
 *      "policy rejected" from "blockchain execution failed".
 *
 *   5. DEMO SELF-TRANSFER: in the current demo, the treasury sends tokens
 *      to itself (toWalletAddress = treasury.walletAddress). In production,
 *      each vendor would have a registered Solana wallet address.
 */

import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { CreateSpendRequestSchema, AuditEventType, ActorType, AgentStatus, Currency, PolicyDecision } from '@aegis/shared';
import { evaluate } from '@aegis/policy-engine';
import { createCompanyMerkleTree, mintDecisionReceipt } from '@aegis/solana';
import { hashApiKey } from '../middleware/auth.js';
import { createAuditLog } from '../services/audit.js';
import { notifyApprovalNeeded } from '../services/notify.js';
import { getSettlementAdapter } from '../services/settlement.js';

export async function spendRequestsRoutes(app: FastifyInstance) {
  // ─── POST /spend-requests ─────────────────────────────────────────────────
  // The main entry point for AI agents. Called every time an agent wants to
  // spend money. The response tells the agent whether it was approved,
  // rejected, or needs human review before it can proceed.
  app.post('/', async (request, reply) => {
    // Step 1: Authenticate agent from Bearer token
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.unauthorized('Missing API key');
    const apiKey = authHeader.slice(7);
    const keyHash = hashApiKey(apiKey);

    // Step 2: Load agent with all context needed for policy evaluation.
    // We load policy + budget + company in one query to minimize DB round-trips.
    // Only the ACTIVE policy and budget are loaded (take: 1 with where active: true).
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

    // Step 3: Parse and validate the request body via Zod schema
    const body = CreateSpendRequestSchema.parse(request.body);

    // Step 4: Compute rolling budget usage — how much has this agent spent today/this month?
    // We only count EXECUTED requests (policy-approved + on-chain confirmed), not PENDING or REJECTED.
    // These aggregates are passed to evaluate() so it can check budget limits.
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

    // Step 5: THE POLICY EVALUATION — pure function, no side effects, deterministic.
    // This is where @aegis/policy-engine decides APPROVED / REQUIRES_APPROVAL / REJECTED.
    // See packages/policy-engine/src/evaluate.ts for the full rule priority order.
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
      // If no policy assigned, pass empty rules — all budget-unrelated checks pass through
      policy: policy ? (policy.rules as object) : {},
      budget: {
        perTransactionLimit: budget ? Number(budget.perTransactionLimit) : 0,
        dailyLimit: budget ? Number(budget.dailyLimit) : 0,
        monthlyLimit: budget ? Number(budget.monthlyLimit) : 0,
        dailySpent: Number(dailyResult._sum.amount ?? 0),
        monthlySpent: Number(monthlyResult._sum.amount ?? 0),
      },
    });

    // Step 6: Map policy decision to SpendRequest status
    // PolicyDecision.APPROVED → status 'APPROVED' (ready to execute)
    // PolicyDecision.REQUIRES_APPROVAL → status 'REQUIRES_APPROVAL' (waiting for human)
    // PolicyDecision.REJECTED → status 'REJECTED' (terminal, no execution)
    const initialStatus =
      evaluationResult.decision === PolicyDecision.APPROVED
        ? 'APPROVED'
        : evaluationResult.decision === PolicyDecision.REQUIRES_APPROVAL
          ? 'REQUIRES_APPROVAL'
          : 'REJECTED';

    // Step 7: Persist the spend request with its initial status and decision metadata.
    // settlementAsset/receiveAsset are stored when the agent declared a cross-currency
    // intent (Stellar path payment); kept null for plain same-asset transfers.
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
        // Cross-currency fields: only set when receiveAsset is provided AND
        // differs from currency. Same-asset requests stay null.
        settlementAsset:
          body.receiveAsset && body.receiveAsset !== body.currency ? body.currency : null,
        receiveAsset:
          body.receiveAsset && body.receiveAsset !== body.currency ? body.receiveAsset : null,
        metadata: body.metadata as Prisma.InputJsonValue,
      },
    });

    // Step 8: Create approval record if human review is needed.
    // The ApprovalRequest appears in GET /approvals/pending for the dashboard.
    // The spend request stays in REQUIRES_APPROVAL status until an admin acts.
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

      // Notify all admins in the company who have email notifications enabled (non-blocking)
      const admins = await app.prisma.user.findMany({
        where: { companyId: agent.companyId, notifyEmail: true },
        select: { email: true },
      });
      if (admins.length > 0) {
        void notifyApprovalNeeded({
          toEmails: admins.map((u) => u.email),
          agentName: agent.name,
          vendor: body.vendor,
          amount: body.amount,
          actionType: body.actionType,
          requestId: spendRequest.id,
        });
      }
    } else {
      // Log APPROVED or REJECTED decisions from the policy engine
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

    // Always log the submission itself (separate from the decision event)
    // This gives the audit trail a clear "agent submitted X" event independent
    // of what the policy engine decided.
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

    // ── cNFT Audit Receipt (fire-and-forget) ────────────────────────────────
    // Mint a compressed NFT on-chain for every policy decision — making the
    // audit trail verifiable on Solana, not just in our DB.
    // Non-blocking: runs after the response is sent so it doesn't slow the agent.
    // Failure is logged but never surfaces to the caller.
    void (async () => {
      const delegateSecret = process.env['AEGIS_DELEGATE_SECRET'];
      if (!delegateSecret) return; // Skip if Permanent Delegate not configured

      try {
        // Lazy Merkle tree creation: if this company doesn't have a tree yet,
        // create one (costs ~0.1 SOL, paid by AEGIS_DELEGATE_SECRET keypair).
        let treeAddress = agent.company.merkleTreeAddress;
        if (!treeAddress) {
          const tree = await createCompanyMerkleTree(delegateSecret);
          treeAddress = tree.treeAddress;
          await app.prisma.company.update({
            where: { id: agent.companyId },
            data: { merkleTreeAddress: treeAddress },
          });
          app.log.info({ treeAddress, companyId: agent.companyId }, '[receipt] Merkle tree created');
        }

        const receipt = await mintDecisionReceipt({
          treeAddress,
          payerSecretBase64: delegateSecret,
          spendRequestId: spendRequest.id,
          decision: evaluationResult.decision,
          agentId: agent.id,
          vendor: body.vendor,
          amount: body.amount,
          // exactOptionalPropertyTypes: omit optional fields instead of passing undefined
          ...(agent.treasury?.walletAddress ? { ownerAddress: agent.treasury.walletAddress } : {}),
          ...(evaluationResult.matchedRule ? { matchedRule: evaluationResult.matchedRule } : {}),
        });

        if (receipt) {
          app.log.info(
            { spendRequestId: spendRequest.id, assetId: receipt.assetId, leafIndex: receipt.leafIndex },
            '[receipt] cNFT minted',
          );
          // Append receipt info to the existing submission audit log payload
          // by creating a dedicated receipt audit log entry.
          await createAuditLog({
            prisma: app.prisma,
            companyId: agent.companyId,
            agentId: agent.id,
            spendRequestId: spendRequest.id,
            eventType: AuditEventType.SPEND_REQUEST_SUBMITTED, // reuse event type for receipt
            actorType: ActorType.SYSTEM,
            actorId: 'receipt-minter',
            payload: {
              receiptAssetId: receipt.assetId,
              receiptLeafIndex: receipt.leafIndex,
              receiptTxSignature: receipt.txSignature,
              receiptExplorerUrl: receipt.explorerUrl,
              merkleTreeAddress: receipt.treeAddress,
            },
          });
        }
      } catch (err) {
        app.log.error({ err, spendRequestId: spendRequest.id }, '[receipt] cNFT mint failed');
      }
    })();

    return reply.status(201).send(spendRequest);
  });

  // ─── GET /spend-requests/:requestId ──────────────────────────────────────
  // Agents poll this to check whether their request was approved and whether
  // a Solana transaction was executed. The txSignature field, when populated,
  // links to Solana Explorer for on-chain verification.
  app.get<{ Params: { requestId: string } }>('/:requestId', async (request, reply) => {
    const spendRequest = await app.prisma.spendRequest.findUnique({
      where: { id: request.params.requestId },
      include: { approvalRequest: true },
    });
    if (!spendRequest) return reply.notFound('Spend request not found');
    return spendRequest;
  });

  // ─── POST /spend-requests/:requestId/execute ──────────────────────────────
  // Triggers the actual Solana SPL token transfer for an APPROVED request.
  //
  // This is the Solana integration point. After this call:
  //   - A real on-chain transaction exists with a verifiable signature
  //   - txSignature and explorerUrl are stored on the SpendRequest
  //   - Status changes to EXECUTED
  //   - The audit log captures the tx signature and Explorer link
  //
  // Can only be called on requests with status === 'APPROVED'.
  // The approvals route (approvals.ts) sets status to APPROVED after human
  // review, making this callable for REQUIRES_APPROVAL → human approves → execute.
  app.post<{ Params: { requestId: string } }>('/:requestId/execute', async (request, reply) => {
    const spendRequest = await app.prisma.spendRequest.findUnique({
      where: { id: request.params.requestId },
      include: {
        agent: { include: { treasury: true } },
        approvalRequest: true,
      },
    });

    if (!spendRequest) return reply.notFound('Spend request not found');

    // Guard: only APPROVED requests can be executed.
    // REQUIRES_APPROVAL must go through human review first.
    // REJECTED and FAILED are terminal states.
    if (spendRequest.status !== 'APPROVED') {
      return reply.badRequest(`Cannot execute request with status ${spendRequest.status}`);
    }

    const treasury = spendRequest.agent.treasury;
    if (!treasury) return reply.badRequest('Agent has no treasury configured');

    // FROZEN treasury = kill switch was activated. No transfers allowed.
    // This is a belt-and-suspenders check — the policy engine also blocks at Rule 1.
    if (treasury.status === 'FROZEN') return reply.badRequest('Treasury is frozen');

    try {
      // Resolve the right settlement adapter for this treasury's network.
      // Routes Solana → @aegis/solana, Stellar → @aegis/stellar transparently.
      const adapter = await getSettlementAdapter(treasury.network);

      // Look up the vendor's registered wallet address.
      // First try VendorWallet matching the treasury's network (multi-chain path),
      // then fall back to legacy Vendor.walletAddress (single-chain back-compat),
      // then fall back to treasury self-transfer (unknown vendor demo case).
      const vendorRecord = await app.prisma.vendor.findFirst({
        where: {
          companyId: spendRequest.companyId,
          name: { equals: spendRequest.vendor, mode: 'insensitive' },
          status: 'ACTIVE',
        },
        include: {
          wallets: {
            where: { network: treasury.network },
            take: 1,
          },
        },
      });

      const networkSpecificWallet = vendorRecord?.wallets[0]?.walletAddress;
      const vendorWallet =
        networkSpecificWallet ?? vendorRecord?.walletAddress ?? treasury.walletAddress;

      // Execute via the chain-agnostic adapter contract.
      // - asset: what the treasury sends (currency on the SpendRequest)
      // - receiveAsset: optional, set when the agent requested a cross-currency
      //   path payment (Stellar). When provided + different from asset, the
      //   Stellar adapter routes to pathPaymentStrictReceive.
      const result = await adapter.transfer({
        fromEncryptedSecret: treasury.encryptedSecret,
        toPublicKey: vendorWallet,
        amount: Number(spendRequest.amount),
        asset: spendRequest.currency,
        ...(spendRequest.receiveAsset ? { receiveAsset: spendRequest.receiveAsset } : {}),
      });

      // Update the SpendRequest with the on-chain proof.
      // Path payment metadata (path, sourceAmount, conversionRate) is captured
      // when the chain implementation populated result.pathPayment.
      const updated = await app.prisma.spendRequest.update({
        where: { id: spendRequest.id },
        data: {
          status: 'EXECUTED',
          txSignature: result.signature,           // Solana sig OR Stellar tx hash
          explorerUrl: result.explorerUrl,         // Solana Explorer or stellar.expert link
          vendorWalletAddress: vendorWallet,       // Record where funds actually went
          ...(result.pathPayment
            ? {
                conversionRate: result.pathPayment.conversionRate,
                pathPaymentPath: result.pathPayment.path as Prisma.InputJsonValue,
              }
            : {}),
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
        payload: {
          txSignature: result.signature,
          explorerUrl: result.explorerUrl,
          amount: spendRequest.amount,
          ...(result.pathPayment
            ? {
                pathPayment: {
                  path: result.pathPayment.path,
                  sourceAmount: result.pathPayment.sourceAmount,
                  conversionRate: result.pathPayment.conversionRate,
                },
              }
            : {}),
        },
      });

      return updated;
    } catch (err) {
      // Execution failure: mark as FAILED so it's distinguishable from REJECTED.
      // FAILED = "policy approved it but blockchain execution failed" (network issue, insufficient funds, etc.)
      // REJECTED = "policy blocked it before any Solana interaction"
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

  // ─── GET /spend-requests ─────────────────────────────────────────────────
  // Admin/dashboard list of all spend requests for a company.
  // Supports filtering by status and pagination via limit.
  app.get<{ Querystring: { companyId: string; status?: string; limit?: string } }>(
    '/',
    async (request, reply) => {
      const { companyId, status, limit } = request.query;
      if (!companyId) return reply.badRequest('companyId is required');

      const requests = await app.prisma.spendRequest.findMany({
        where: { companyId, ...(status ? { status: status as 'PENDING' } : {}) },
        include: { agent: { select: { id: true, name: true, type: true } }, approvalRequest: true },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(limit ?? 50), 200), // Cap at 200 to prevent runaway queries
      });
      return requests;
    },
  );
}
