import {
  AgentStatus,
  PolicyDecision,
  type PolicyEvaluationInput,
  type PolicyEvaluationResult,
} from '@command-rail/shared';

export type EvaluationContext = PolicyEvaluationInput;

/**
 * Core policy evaluation function.
 * Pure function — no I/O, fully deterministic and testable.
 * Rules are evaluated in priority order: blocking rules first, then budget, then approval.
 */
export function evaluate(ctx: EvaluationContext): PolicyEvaluationResult {
  const { spendRequest, agent, policy, budget } = ctx;

  // ─── Rule 1: Kill switch ───────────────────────────────────────────────────
  if (agent.killSwitchActive) {
    return reject('kill_switch', 'Agent kill switch is active. All requests are blocked.');
  }

  // ─── Rule 2: Agent disabled ───────────────────────────────────────────────
  if (agent.status === AgentStatus.DISABLED) {
    return reject('agent_disabled', 'Agent is disabled and cannot submit spend requests.');
  }

  // ─── Rule 3: Allowed action types ─────────────────────────────────────────
  if (policy.allowedActionTypes && policy.allowedActionTypes.length > 0) {
    if (!policy.allowedActionTypes.includes(spendRequest.actionType)) {
      return reject(
        'action_type_not_allowed',
        `Action type '${spendRequest.actionType}' is not allowed. Permitted: ${policy.allowedActionTypes.join(', ')}.`,
      );
    }
  }

  // ─── Rule 4: Vendor deny list ─────────────────────────────────────────────
  if (policy.vendorDenyList && policy.vendorDenyList.length > 0) {
    const normalizedVendor = spendRequest.vendor.toLowerCase();
    const isDenied = policy.vendorDenyList.some((v) => v.toLowerCase() === normalizedVendor);
    if (isDenied) {
      return reject(
        'vendor_denied',
        `Vendor '${spendRequest.vendor}' is on the deny list and cannot be used.`,
      );
    }
  }

  // ─── Rule 5: Vendor allow list ────────────────────────────────────────────
  if (policy.vendorAllowList && policy.vendorAllowList.length > 0) {
    const normalizedVendor = spendRequest.vendor.toLowerCase();
    const isAllowed = policy.vendorAllowList.some((v) => v.toLowerCase() === normalizedVendor);
    if (!isAllowed) {
      return reject(
        'vendor_not_allowed',
        `Vendor '${spendRequest.vendor}' is not on the allow list. Permitted: ${policy.vendorAllowList.join(', ')}.`,
      );
    }
  }

  // ─── Rule 6: Per-transaction limit ────────────────────────────────────────
  if (budget.perTransactionLimit > 0 && spendRequest.amount > budget.perTransactionLimit) {
    return reject(
      'per_transaction_limit_exceeded',
      `Transaction amount ${spendRequest.amount} ${spendRequest.currency} exceeds per-transaction limit of ${budget.perTransactionLimit} ${spendRequest.currency}.`,
    );
  }

  if (policy.maxTransactionAmount && spendRequest.amount > policy.maxTransactionAmount) {
    return reject(
      'max_transaction_amount_exceeded',
      `Transaction amount ${spendRequest.amount} ${spendRequest.currency} exceeds policy maximum of ${policy.maxTransactionAmount} ${spendRequest.currency}.`,
    );
  }

  // ─── Rule 7: Daily budget ─────────────────────────────────────────────────
  if (budget.dailyLimit > 0) {
    const projectedDaily = budget.dailySpent + spendRequest.amount;
    if (projectedDaily > budget.dailyLimit) {
      return reject(
        'daily_budget_exceeded',
        `This transaction would exceed the daily budget. Spent: ${budget.dailySpent}, limit: ${budget.dailyLimit} ${spendRequest.currency}.`,
      );
    }
  }

  // ─── Rule 8: Monthly budget ───────────────────────────────────────────────
  if (budget.monthlyLimit > 0) {
    const projectedMonthly = budget.monthlySpent + spendRequest.amount;
    if (projectedMonthly > budget.monthlyLimit) {
      return reject(
        'monthly_budget_exceeded',
        `This transaction would exceed the monthly budget. Spent: ${budget.monthlySpent}, limit: ${budget.monthlyLimit} ${spendRequest.currency}.`,
      );
    }
  }

  // ─── Rule 9: Requires approval ────────────────────────────────────────────
  if (policy.requireApprovalAbove && spendRequest.amount > policy.requireApprovalAbove) {
    return {
      decision: PolicyDecision.REQUIRES_APPROVAL,
      reason: `Transaction amount ${spendRequest.amount} ${spendRequest.currency} exceeds auto-approval threshold of ${policy.requireApprovalAbove} ${spendRequest.currency}. Human approval required.`,
      matchedRule: 'require_approval_above',
      policySnapshot: policy,
    };
  }

  // ─── Auto-approved ────────────────────────────────────────────────────────
  return {
    decision: PolicyDecision.APPROVED,
    reason: 'All policy checks passed. Request auto-approved.',
    matchedRule: 'none',
    policySnapshot: policy,
  };
}

function reject(rule: string, reason: string): PolicyEvaluationResult {
  return {
    decision: PolicyDecision.REJECTED,
    reason,
    matchedRule: rule,
    policySnapshot: {},
  };
}
