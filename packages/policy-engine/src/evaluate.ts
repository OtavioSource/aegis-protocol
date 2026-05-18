/**
 * Policy Engine — função pura, síncrona, sem I/O.
 *
 * Avalia uma `SpendRequestInput` contra uma `Policy` ativa, dado o
 * `RuntimeContext` pré-carregado pelo orchestrator.
 *
 * Características críticas (ver `docs/adr/0006-policy-engine-puro-sem-io.md`):
 * - Sem `await`, sem rede, sem DB, sem `Date.now()`, sem `Math.random()`.
 * - Determinística: mesmas entradas → mesma saída sempre.
 * - Sem mutação de input.
 * - Retorna discriminated union; nunca `throw`.
 *
 * Ordem canônica de avaliação (ver `docs/09-policy-dsl.md §4`):
 *   1. actionTypes
 *   2. vendorDenyList
 *   3. vendorAllowList
 *   4. maxPerTransactionCents
 *   5. monthlyBudgetCents
 *   6. humanApprovalThresholdCents → REQUIRES_APPROVAL
 *   (fallback) APPROVED
 */

import {
  type Decision,
  DecisionType,
  type Policy,
  PolicyRuleName,
  type RuntimeContext,
  type SpendRequestInput,
} from '@aegis/shared';

export function evaluate(
  request: SpendRequestInput,
  policy: Policy,
  context: RuntimeContext,
): Decision {
  const r = policy.rules;

  // 1. actionType permitido?
  if (r.actionTypes.length > 0 && !r.actionTypes.includes(request.actionType)) {
    return {
      decision: DecisionType.REJECTED,
      reason: `actionType '${request.actionType}' not in policy.actionTypes`,
      ruleHit: PolicyRuleName.ACTION_TYPES,
    };
  }

  // 2. vendor em denyList? (vence allowList por design — ver doc-string do schema)
  if (r.vendorDenyList.includes(request.vendorId)) {
    return {
      decision: DecisionType.REJECTED,
      reason: `vendor ${request.vendorId} is in denyList`,
      ruleHit: PolicyRuleName.VENDOR_DENY_LIST,
    };
  }

  // 3. vendor em allowList? (apenas avalia se allowList não vazia)
  if (r.vendorAllowList.length > 0 && !r.vendorAllowList.includes(request.vendorId)) {
    return {
      decision: DecisionType.REJECTED,
      reason: `vendor ${request.vendorId} not in allowList`,
      ruleHit: PolicyRuleName.VENDOR_ALLOW_LIST,
    };
  }

  // 4. limite por transação
  if (r.maxPerTransactionCents !== null && request.amountCents > r.maxPerTransactionCents) {
    return {
      decision: DecisionType.REJECTED,
      reason: `amount ${request.amountCents} exceeds maxPerTransactionCents ${r.maxPerTransactionCents}`,
      ruleHit: PolicyRuleName.MAX_PER_TRANSACTION_CENTS,
    };
  }

  // 5. budget mensal
  if (r.monthlyBudgetCents !== null) {
    const wouldSpend = context.monthlySpentCents + request.amountCents;
    if (wouldSpend > r.monthlyBudgetCents) {
      return {
        decision: DecisionType.REJECTED,
        reason: `would spend ${wouldSpend} exceeds monthlyBudgetCents ${r.monthlyBudgetCents}`,
        ruleHit: PolicyRuleName.MONTHLY_BUDGET_CENTS,
      };
    }
  }

  // 6. acima do threshold humano? escala (não rejeita)
  if (
    r.humanApprovalThresholdCents !== null &&
    request.amountCents >= r.humanApprovalThresholdCents
  ) {
    return {
      decision: DecisionType.REQUIRES_APPROVAL,
      reason: `amount ${request.amountCents} >= humanApprovalThresholdCents ${r.humanApprovalThresholdCents}`,
      ruleHit: PolicyRuleName.HUMAN_APPROVAL_THRESHOLD_CENTS,
    };
  }

  // Passou em todos os checks
  return { decision: DecisionType.APPROVED };
}
