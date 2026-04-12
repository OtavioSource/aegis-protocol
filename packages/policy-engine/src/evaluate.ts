/**
 * @file evaluate.ts
 * @package @aegis/policy-engine
 *
 * ═══════════════════════════════════════════════════════════════
 *  THE CORE OF COMMANDRAIL — POLICY EVALUATION ENGINE
 * ═══════════════════════════════════════════════════════════════
 *
 * This is the most important file in the system. It is the single
 * function that decides whether an AI agent's spend request is:
 *
 *   - APPROVED     → execute the Solana transfer automatically
 *   - REQUIRES_APPROVAL → hold for human review in the dashboard
 *   - REJECTED     → block, log, move on — no funds leave
 *
 * Design principles (never break these):
 *
 *   1. PURE FUNCTION — no database calls, no HTTP, no side effects.
 *      Takes data in, returns a decision out. Always.
 *
 *   2. DETERMINISTIC — same input always produces the same output.
 *      No randomness, no time-based logic inside the evaluator.
 *
 *   3. PRIORITY ORDER — rules are evaluated top-to-bottom.
 *      The first rule that matches wins and short-circuits the rest.
 *      Blocking rules (kill switch, disabled) always run first.
 *
 *   4. ZERO TRUST — default to rejecting on anything unexpected.
 *      The "pass" path only exists at the very end after all checks.
 *
 *   5. TESTABLE — every rule has a dedicated unit test. If you add
 *      a rule, add a test. See __tests__/evaluate.test.ts.
 *
 * Rule priority order:
 *   1. kill_switch              (agent-level emergency stop)
 *   2. agent_disabled           (soft disable, preserves history)
 *   3. action_type_not_allowed  (restrict what agents can do)
 *   4. vendor_denied            (explicit block list)
 *   5. vendor_not_allowed       (explicit allow list)
 *   6. per_transaction_limit    (budget-level ceiling)
 *   7. max_transaction_amount   (policy-level ceiling)
 *   8. daily_budget_exceeded    (rolling 24h spend limit)
 *   9. monthly_budget_exceeded  (rolling 30d spend limit)
 *  10. require_approval_above   (escalate to human above threshold)
 *  11. (pass) → APPROVED        (all checks passed)
 */

import {
  AgentStatus,
  PolicyDecision,
  type PolicyEvaluationInput,
  type PolicyEvaluationResult,
} from '@aegis/shared';

/**
 * EvaluationContext — everything the policy engine needs to make a decision.
 * Constructed by the API layer from live DB data before calling evaluate().
 *
 * Critically, the policy engine never touches the database itself.
 * The API is responsible for fetching budgets, daily/monthly spend totals,
 * agent status, and active policy rules — then passing them here.
 */
export type EvaluationContext = PolicyEvaluationInput;

/**
 * evaluate() — the governance decision function.
 *
 * Called once per spend request, immediately after the agent submits it.
 * The result determines the request's initial status and whether a Solana
 * transfer is triggered (APPROVED) or a human is notified (REQUIRES_APPROVAL).
 *
 * @param ctx - All context needed to make a decision (no I/O allowed inside)
 * @returns PolicyEvaluationResult with decision, reason, matched rule, and policy snapshot
 *
 * @example
 * const result = evaluate({
 *   spendRequest: { amount: 15, vendor: 'OpenAI', actionType: 'purchase_inference', currency: 'USDC' },
 *   agent: { status: AgentStatus.ACTIVE, killSwitchActive: false },
 *   policy: { requireApprovalAbove: 10, vendorAllowList: ['OpenAI'] },
 *   budget: { perTransactionLimit: 50, dailyLimit: 100, monthlyLimit: 500, dailySpent: 20, monthlySpent: 80 },
 * });
 * // → { decision: 'REQUIRES_APPROVAL', matchedRule: 'require_approval_above', ... }
 */
export function evaluate(ctx: EvaluationContext): PolicyEvaluationResult {
  const { spendRequest, agent, policy, budget } = ctx;

  // ─── Rule 1: Kill switch ───────────────────────────────────────────────────
  // The nuclear option. When active, ALL requests from this agent are blocked
  // regardless of amount, vendor, or any other policy rule.
  // Activated via POST /agents/:id/kill-switch { active: true }
  // Visible as a red banner in the dashboard. Instant, no confirmation needed.
  if (agent.killSwitchActive) {
    return reject('kill_switch', 'Agent kill switch is active. All requests are blocked.');
  }

  // ─── Rule 2: Agent disabled ───────────────────────────────────────────────
  // Soft-disable: agent exists in the system (history preserved) but cannot
  // submit new requests. Different from kill switch — this is a permanent
  // administrative action, not an emergency stop.
  if (agent.status === AgentStatus.DISABLED) {
    return reject('agent_disabled', 'Agent is disabled and cannot submit spend requests.');
  }

  // ─── Rule 3: Allowed action types ─────────────────────────────────────────
  // Restricts what categories of economic action this agent can perform.
  // Example: a marketing agent might only be allowed 'purchase_api_access'
  // and 'enrich_leads', preventing it from buying compute or infrastructure.
  // Empty list = all action types allowed.
  if (policy.allowedActionTypes && policy.allowedActionTypes.length > 0) {
    if (!policy.allowedActionTypes.includes(spendRequest.actionType)) {
      return reject(
        'action_type_not_allowed',
        `Action type '${spendRequest.actionType}' is not allowed. Permitted: ${policy.allowedActionTypes.join(', ')}.`,
      );
    }
  }

  // ─── Rule 4: Vendor deny list ─────────────────────────────────────────────
  // Explicit block list. Even if a vendor would otherwise pass all other checks,
  // if it's on the deny list it's rejected. Case-insensitive comparison.
  // Useful for blocking competitors, known bad actors, or unapproved suppliers.
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
  // Whitelist mode: only vendors explicitly listed can receive payments.
  // This is the default recommended posture — opt-in, not opt-out.
  // Empty list = all vendors allowed (open mode — use with care).
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

  // ─── Rule 6: Per-transaction limit (budget-level) ─────────────────────────
  // Hard ceiling per individual transaction set at the Budget entity level.
  // This is the coarser control — the Budget.perTransactionLimit applies
  // regardless of the policy's maxTransactionAmount.
  if (budget.perTransactionLimit > 0 && spendRequest.amount > budget.perTransactionLimit) {
    return reject(
      'per_transaction_limit_exceeded',
      `Transaction amount ${spendRequest.amount} ${spendRequest.currency} exceeds per-transaction limit of ${budget.perTransactionLimit} ${spendRequest.currency}.`,
    );
  }

  // ─── Rule 6b: Max transaction amount (policy-level) ───────────────────────
  // Finer-grained ceiling defined in the Policy rules JSON.
  // Both limits coexist: budget.perTransactionLimit is the outer constraint,
  // policy.maxTransactionAmount can be stricter for a specific agent.
  if (policy.maxTransactionAmount && spendRequest.amount > policy.maxTransactionAmount) {
    return reject(
      'max_transaction_amount_exceeded',
      `Transaction amount ${spendRequest.amount} ${spendRequest.currency} exceeds policy maximum of ${policy.maxTransactionAmount} ${spendRequest.currency}.`,
    );
  }

  // ─── Rule 7: Daily budget ─────────────────────────────────────────────────
  // Rolling 24-hour spend limit. The API computes dailySpent by summing all
  // EXECUTED requests from this agent since midnight (UTC) before calling evaluate().
  // This is a projection check: would this transaction push us over the limit?
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
  // Same as daily but rolling 30-day window. Both limits are checked independently.
  // An agent can be under daily limit but over monthly — that still rejects.
  if (budget.monthlyLimit > 0) {
    const projectedMonthly = budget.monthlySpent + spendRequest.amount;
    if (projectedMonthly > budget.monthlyLimit) {
      return reject(
        'monthly_budget_exceeded',
        `This transaction would exceed the monthly budget. Spent: ${budget.monthlySpent}, limit: ${budget.monthlyLimit} ${spendRequest.currency}.`,
      );
    }
  }

  // ─── Rule 9: Requires human approval ──────────────────────────────────────
  // This is the "escalation" rule. The request passes all hard blocks above,
  // but the amount is above the auto-approve threshold, so it needs a human
  // to review it in the dashboard before the Solana transfer executes.
  //
  // This rule DOES NOT reject — it creates a REQUIRES_APPROVAL record that
  // appears in the admin approval queue. Once approved, the transfer proceeds.
  // Once rejected, the spend request is marked REJECTED (no funds move).
  if (policy.requireApprovalAbove && spendRequest.amount > policy.requireApprovalAbove) {
    return {
      decision: PolicyDecision.REQUIRES_APPROVAL,
      reason: `Transaction amount ${spendRequest.amount} ${spendRequest.currency} exceeds auto-approval threshold of ${policy.requireApprovalAbove} ${spendRequest.currency}. Human approval required.`,
      matchedRule: 'require_approval_above',
      policySnapshot: policy,
    };
  }

  // ─── APPROVED ─────────────────────────────────────────────────────────────
  // All 9 rules passed. The spend request is auto-approved.
  // The API will immediately trigger the Solana SPL token transfer
  // (or the agent can call POST /spend-requests/:id/execute explicitly).
  return {
    decision: PolicyDecision.APPROVED,
    reason: 'All policy checks passed. Request auto-approved.',
    matchedRule: 'none',
    policySnapshot: policy,
  };
}

/**
 * reject() — helper to construct a REJECTED result.
 *
 * Separated into a helper to keep the main evaluate() function readable
 * and to ensure all rejections have a consistent structure.
 * policySnapshot is empty on rejections — the rule that blocked didn't need
 * to capture the full policy context.
 */
function reject(rule: string, reason: string): PolicyEvaluationResult {
  return {
    decision: PolicyDecision.REJECTED,
    reason,
    matchedRule: rule,
    policySnapshot: {},
  };
}
