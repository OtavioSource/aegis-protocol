import { describe, it, expect } from 'vitest';
import { evaluate } from '../evaluate.js';
import { AgentStatus, PolicyDecision, Currency } from '@command-rail/shared';
import type { EvaluationContext } from '../evaluate.js';

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    spendRequest: {
      amount: 5,
      vendor: 'DataVendorX',
      actionType: 'purchase_api_access',
      currency: Currency.USDC,
    },
    agent: {
      status: AgentStatus.ACTIVE,
      killSwitchActive: false,
    },
    policy: {
      requireApprovalAbove: 10,
      maxTransactionAmount: 50,
    },
    budget: {
      perTransactionLimit: 50,
      dailyLimit: 100,
      monthlyLimit: 1500,
      dailySpent: 0,
      monthlySpent: 0,
    },
    ...overrides,
  };
}

describe('Kill switch', () => {
  it('should reject when kill switch is active', () => {
    const result = evaluate(makeCtx({ agent: { status: AgentStatus.ACTIVE, killSwitchActive: true } }));
    expect(result.decision).toBe(PolicyDecision.REJECTED);
    expect(result.matchedRule).toBe('kill_switch');
  });
});

describe('Agent status', () => {
  it('should reject when agent is disabled', () => {
    const result = evaluate(makeCtx({ agent: { status: AgentStatus.DISABLED, killSwitchActive: false } }));
    expect(result.decision).toBe(PolicyDecision.REJECTED);
    expect(result.matchedRule).toBe('agent_disabled');
  });
});

describe('Action types', () => {
  it('should reject when action type is not allowed', () => {
    const result = evaluate(
      makeCtx({ policy: { allowedActionTypes: ['purchase_api_access'] }, spendRequest: { amount: 5, vendor: 'VendorA', actionType: 'send_email', currency: Currency.USDC } }),
    );
    expect(result.decision).toBe(PolicyDecision.REJECTED);
    expect(result.matchedRule).toBe('action_type_not_allowed');
  });

  it('should pass when action type is in allowed list', () => {
    const result = evaluate(
      makeCtx({ policy: { allowedActionTypes: ['purchase_api_access'], requireApprovalAbove: 10 }, spendRequest: { amount: 5, vendor: 'VendorA', actionType: 'purchase_api_access', currency: Currency.USDC } }),
    );
    expect(result.decision).toBe(PolicyDecision.APPROVED);
  });
});

describe('Vendor deny list', () => {
  it('should reject when vendor is on deny list', () => {
    const result = evaluate(
      makeCtx({ policy: { vendorDenyList: ['BlockedVendor'] }, spendRequest: { amount: 5, vendor: 'BlockedVendor', actionType: 'purchase_api_access', currency: Currency.USDC } }),
    );
    expect(result.decision).toBe(PolicyDecision.REJECTED);
    expect(result.matchedRule).toBe('vendor_denied');
  });

  it('deny list check is case-insensitive', () => {
    const result = evaluate(
      makeCtx({ policy: { vendorDenyList: ['blockedvendor'] }, spendRequest: { amount: 5, vendor: 'BlockedVendor', actionType: 'purchase_api_access', currency: Currency.USDC } }),
    );
    expect(result.decision).toBe(PolicyDecision.REJECTED);
  });
});

describe('Vendor allow list', () => {
  it('should reject when vendor is not on allow list', () => {
    const result = evaluate(
      makeCtx({ policy: { vendorAllowList: ['ApprovedVendor'] }, spendRequest: { amount: 5, vendor: 'UnknownVendor', actionType: 'purchase_api_access', currency: Currency.USDC } }),
    );
    expect(result.decision).toBe(PolicyDecision.REJECTED);
    expect(result.matchedRule).toBe('vendor_not_allowed');
  });

  it('should allow when vendor is on allow list', () => {
    const result = evaluate(
      makeCtx({ policy: { vendorAllowList: ['ApprovedVendor'], requireApprovalAbove: 10 }, spendRequest: { amount: 5, vendor: 'ApprovedVendor', actionType: 'purchase_api_access', currency: Currency.USDC } }),
    );
    expect(result.decision).toBe(PolicyDecision.APPROVED);
  });
});

describe('Per-transaction limit', () => {
  it('should reject when amount exceeds per-transaction budget limit', () => {
    const result = evaluate(makeCtx({ budget: { perTransactionLimit: 10, dailyLimit: 100, monthlyLimit: 1500, dailySpent: 0, monthlySpent: 0 }, spendRequest: { amount: 15, vendor: 'VendorA', actionType: 'purchase_api_access', currency: Currency.USDC } }));
    expect(result.decision).toBe(PolicyDecision.REJECTED);
    expect(result.matchedRule).toBe('per_transaction_limit_exceeded');
  });

  it('should reject when amount exceeds policy maxTransactionAmount', () => {
    const result = evaluate(makeCtx({ policy: { maxTransactionAmount: 10 }, spendRequest: { amount: 15, vendor: 'DataVendorX', actionType: 'purchase_api_access', currency: Currency.USDC } }));
    expect(result.decision).toBe(PolicyDecision.REJECTED);
    expect(result.matchedRule).toBe('max_transaction_amount_exceeded');
  });
});

describe('Daily budget', () => {
  it('should reject when daily budget would be exceeded', () => {
    const result = evaluate(makeCtx({ budget: { perTransactionLimit: 100, dailyLimit: 50, monthlyLimit: 1500, dailySpent: 45, monthlySpent: 45 }, spendRequest: { amount: 10, vendor: 'DataVendorX', actionType: 'purchase_api_access', currency: Currency.USDC } }));
    expect(result.decision).toBe(PolicyDecision.REJECTED);
    expect(result.matchedRule).toBe('daily_budget_exceeded');
  });

  it('should approve when spend is within daily budget', () => {
    const result = evaluate(makeCtx({ budget: { perTransactionLimit: 100, dailyLimit: 100, monthlyLimit: 1500, dailySpent: 90, monthlySpent: 90 }, spendRequest: { amount: 5, vendor: 'DataVendorX', actionType: 'purchase_api_access', currency: Currency.USDC }, policy: { requireApprovalAbove: 50 } }));
    expect(result.decision).toBe(PolicyDecision.APPROVED);
  });
});

describe('Monthly budget', () => {
  it('should reject when monthly budget would be exceeded', () => {
    const result = evaluate(makeCtx({ budget: { perTransactionLimit: 100, dailyLimit: 100, monthlyLimit: 500, dailySpent: 0, monthlySpent: 495 }, spendRequest: { amount: 10, vendor: 'DataVendorX', actionType: 'purchase_api_access', currency: Currency.USDC } }));
    expect(result.decision).toBe(PolicyDecision.REJECTED);
    expect(result.matchedRule).toBe('monthly_budget_exceeded');
  });
});

describe('Approval threshold', () => {
  it('should require approval when amount exceeds threshold', () => {
    const result = evaluate(makeCtx({ policy: { requireApprovalAbove: 10 }, spendRequest: { amount: 25, vendor: 'DataVendorX', actionType: 'purchase_api_access', currency: Currency.USDC } }));
    expect(result.decision).toBe(PolicyDecision.REQUIRES_APPROVAL);
    expect(result.matchedRule).toBe('require_approval_above');
  });

  it('should auto-approve when amount is exactly at threshold', () => {
    const result = evaluate(makeCtx({ policy: { requireApprovalAbove: 10 }, spendRequest: { amount: 10, vendor: 'DataVendorX', actionType: 'purchase_api_access', currency: Currency.USDC } }));
    expect(result.decision).toBe(PolicyDecision.APPROVED);
  });
});

describe('Auto-approve', () => {
  it('should auto-approve when all rules pass', () => {
    const result = evaluate(makeCtx());
    expect(result.decision).toBe(PolicyDecision.APPROVED);
    expect(result.matchedRule).toBe('none');
  });

  it('should return policy snapshot with result', () => {
    const result = evaluate(makeCtx());
    expect(result.policySnapshot).toBeDefined();
  });
});
