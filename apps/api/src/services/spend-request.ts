/**
 * Spend Request Orchestrator.
 *
 * Componente central da API que compõe a Policy Engine pura
 * (@aegis/policy-engine) com I/O na borda:
 *
 *   1. Idempotência (Idempotency-Key + body hash)
 *   2. Lookup do Agent → Company → Policy ativa
 *   3. Cálculo do RuntimeContext (monthlySpentCents via SQL agregado)
 *   4. Invoca evaluate() pura
 *   5. Persiste SpendRequest com decision + policySnapshot
 *   6. Cria AuditEvent (sorobanTxHash NULL — emissão on-chain vem na iter 11)
 *
 * NÃO toca Stellar nesta iteração — status fica em APPROVED/REQUIRES_APPROVAL/
 * REJECTED. Worker de execução on-chain (Payment USDC) entra na iteração 6.
 */

import { evaluate } from '@aegis/policy-engine';
import {
  DecisionType,
  type Policy as PolicyDomain,
  type PolicyRules,
  type RuntimeContext,
  type SpendRequestInput,
} from '@aegis/shared';
import type {
  Agent,
  Policy,
  PrismaClient,
  SpendRequest,
  SpendRequestStatus,
  Vendor,
} from '@prisma/client';
import { EventType } from '@prisma/client';

import { NotFoundError, ValidationError } from '../lib/errors.js';
import { assertSameBody, hashRequestBody } from '../lib/idempotency.js';

const IDEMPOTENCY_HASH_KEY = '__idempotencyBodyHash';

export interface CreateSpendRequestInput {
  agent: Agent;
  body: SpendRequestInput;
  idempotencyKey: string;
}

export interface SpendRequestResult {
  spendRequest: SpendRequest;
  /** true se foi retornado de uma chamada anterior (idempotency hit), false se foi criado agora. */
  reused: boolean;
}

/**
 * Cria (ou retorna existente via idempotency) uma SpendRequest, rodando a
 * Policy Engine e persistindo decisão + audit event atomicamente.
 */
export async function createSpendRequest(
  prisma: PrismaClient,
  input: CreateSpendRequestInput,
): Promise<SpendRequestResult> {
  const { agent, body, idempotencyKey } = input;
  const bodyHash = hashRequestBody(body);

  // 1. Idempotency check
  const existing = await prisma.spendRequest.findUnique({
    where: { companyId_idempotencyKey: { companyId: agent.companyId, idempotencyKey } },
  });
  if (existing) {
    const storedHash = (existing.metadata as Record<string, unknown> | null)?.[
      IDEMPOTENCY_HASH_KEY
    ] as string | undefined;
    assertSameBody(idempotencyKey, bodyHash, storedHash);
    return { spendRequest: existing, reused: true };
  }

  // 2. Resolver Policy ativa do agent + Vendor
  const [policy, vendor] = await Promise.all([
    prisma.policy.findFirst({
      where: { id: agent.activePolicyId, companyId: agent.companyId },
    }),
    prisma.vendor.findFirst({
      where: { id: body.vendorId, companyId: agent.companyId },
      include: { wallets: { where: { isPrimary: true } } },
    }),
  ]);
  if (!policy) {
    throw new NotFoundError(`Active policy ${agent.activePolicyId} not found`);
  }
  if (!vendor) {
    throw new ValidationError(`Vendor ${body.vendorId} not found in this Company`);
  }

  // 3. Calcular RuntimeContext (monthly aggregate)
  const monthlySpentCents = await computeMonthlySpentCents(prisma, agent.id);
  const ctx: RuntimeContext = { monthlySpentCents };

  // 4. Invocar engine pura
  const policyDomain: PolicyDomain = {
    id: policy.id,
    name: policy.name,
    version: policy.version,
    rules: policy.rules as PolicyRules,
  };
  const decision = evaluate(body, policyDomain, ctx);

  // 5. Mapear decision → SpendRequestStatus
  const status: SpendRequestStatus =
    decision.decision === DecisionType.APPROVED
      ? 'APPROVED'
      : decision.decision === DecisionType.REQUIRES_APPROVAL
        ? 'REQUIRES_APPROVAL'
        : 'REJECTED';

  // 6. Persistir SpendRequest + AuditEvent atomicamente
  const primaryWallet = vendor.wallets[0];
  const spendRequest = await prisma.$transaction(async (tx) => {
    const sr = await tx.spendRequest.create({
      data: {
        companyId: agent.companyId,
        agentId: agent.id,
        vendorId: vendor.id,
        vendorWalletId: primaryWallet?.id ?? null,
        policyId: policy.id,
        policySnapshot: policy.rules as object,
        amountCents: BigInt(body.amountCents),
        asset: body.asset,
        actionType: body.actionType,
        reason: body.reason ?? null,
        metadata: {
          ...(body.metadata ?? {}),
          [IDEMPOTENCY_HASH_KEY]: bodyHash,
        } as object,
        idempotencyKey,
        status,
        decision: decision.decision,
        decisionReason: decision.decision === DecisionType.APPROVED ? null : decision.reason,
        evaluatedAt: new Date(),
      },
    });

    await tx.auditEvent.create({
      data: {
        companyId: agent.companyId,
        spendRequestId: sr.id,
        eventType: EventType.DECISION_MADE,
        actor: `agent:${agent.id}`,
        payload: {
          decision: decision.decision,
          ...(decision.decision !== DecisionType.APPROVED
            ? { reason: decision.reason, ruleHit: decision.ruleHit }
            : {}),
          amountCents: body.amountCents,
          asset: body.asset,
          actionType: body.actionType,
          vendorId: body.vendorId,
          policyId: policy.id,
          policyVersion: policy.version,
        } as object,
      },
    });

    return sr;
  });

  return { spendRequest, reused: false };
}

/**
 * Soma de `amountCents` das SpendRequests EXECUTED do agente no mês corrente (UTC).
 * Status considerado: apenas EXECUTED (RNF: docs/09 §5).
 *
 * Para iteração 4 (sem execução on-chain), retorna 0 na prática — mas a query
 * já está correta para quando a iteração 6 começar a marcar EXECUTED.
 */
export async function computeMonthlySpentCents(
  prisma: PrismaClient,
  agentId: string,
): Promise<number> {
  const startOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const agg = await prisma.spendRequest.aggregate({
    where: {
      agentId,
      status: 'EXECUTED',
      executedAt: { gte: startOfMonth },
    },
    _sum: { amountCents: true },
  });
  return Number(agg._sum.amountCents ?? 0n);
}

/**
 * Serialização "pública" da SpendRequest para resposta HTTP.
 * - `amountCents` BigInt → number (cabe em Number.MAX_SAFE_INTEGER para valores
 *   realistas; revisar se algum cliente exceder $90 trilhões em uma única tx).
 * - Remove `metadata.__idempotencyBodyHash` (uso interno).
 */
export function serializeSpendRequest(
  sr: SpendRequest,
  options?: { withStellarExpertUrl?: boolean; network?: string },
): Record<string, unknown> {
  const meta = { ...(sr.metadata as Record<string, unknown>) };
  delete meta[IDEMPOTENCY_HASH_KEY];

  const stellarExpertUrl =
    options?.withStellarExpertUrl && sr.txHash
      ? `https://stellar.expert/explorer/${options.network === 'mainnet' ? 'public' : 'testnet'}/tx/${sr.txHash}`
      : null;

  return {
    id: sr.id,
    status: sr.status,
    decision: sr.decision,
    decisionReason: sr.decisionReason,
    amountCents: Number(sr.amountCents),
    asset: sr.asset,
    actionType: sr.actionType,
    reason: sr.reason,
    vendorId: sr.vendorId,
    agentId: sr.agentId,
    policyId: sr.policyId,
    metadata: meta,
    txHash: sr.txHash,
    ledger: sr.ledger,
    sorobanEventTxHash: sr.sorobanEventTxHash,
    stellarExpertUrl,
    createdAt: sr.createdAt,
    evaluatedAt: sr.evaluatedAt,
    executedAt: sr.executedAt,
    failureReason: sr.failureReason,
  };
}
