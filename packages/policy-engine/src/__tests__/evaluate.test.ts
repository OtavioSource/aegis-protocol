/**
 * Testes da Policy Engine.
 *
 * Cobertura alvo: ≥95% lines / 100% functions / ≥90% branches.
 * Casos espelham `docs/09-policy-dsl.md §7` + edge cases adicionais.
 *
 * IDs UUID usados são determinísticos (placeholders) — engine não valida formato,
 * apenas igualdade entre vendorId e listas.
 */

import {
  DecisionType,
  isApproved,
  isRejected,
  isRequiresApproval,
  PolicyRuleName,
  type Policy,
  type RuntimeContext,
  type SpendRequestInput,
} from '@aegis/shared';
import { describe, expect, test } from 'vitest';

import { evaluate } from '../evaluate.js';

// ---------- Fixtures ----------

const VENDOR_A = '11111111-1111-1111-1111-111111111111';
const VENDOR_B = '22222222-2222-2222-2222-222222222222';
const VENDOR_C = '33333333-3333-3333-3333-333333333333';

const POLICY_ID = '99999999-9999-9999-9999-999999999999';

/** Policy "base" usada como ponto de partida em quase todos os testes. */
const basePolicy: Policy = {
  id: POLICY_ID,
  name: 'Test Policy',
  version: 1,
  rules: {
    maxPerTransactionCents: 10_000,
    monthlyBudgetCents: 100_000,
    vendorAllowList: [],
    vendorDenyList: [],
    actionTypes: [],
    maxSpendPerHourCents: null,
    maxPaymentsPerHour: null,
    humanApprovalThresholdCents: 5_000,
  },
};

const baseRequest: SpendRequestInput = {
  vendorId: VENDOR_A,
  amountCents: 1_000,
  asset: 'USDC',
  actionType: 'api-call',
};

const baseCtx: RuntimeContext = { monthlySpentCents: 0 };

/** Helper para clonar a policy mudando apenas algumas rules. */
const withRules = (overrides: Partial<Policy['rules']>): Policy => ({
  ...basePolicy,
  rules: { ...basePolicy.rules, ...overrides },
});

// ---------- APPROVED cases ----------

describe('evaluate — APPROVED', () => {
  test('APPROVED no caso comum (todos os checks passam)', () => {
    const result = evaluate(baseRequest, basePolicy, baseCtx);
    expect(result).toEqual({ decision: DecisionType.APPROVED });
    expect(isApproved(result)).toBe(true);
  });

  test('APPROVED quando vendor está em allowList', () => {
    const policy = withRules({ vendorAllowList: [VENDOR_A, VENDOR_B] });
    const result = evaluate(baseRequest, policy, baseCtx);
    expect(result.decision).toBe(DecisionType.APPROVED);
  });

  test('APPROVED no boundary exato de maxPerTransactionCents (amount == max, sem threshold humano)', () => {
    // strict `>` na implementação → amount == max passa
    const policy = withRules({
      maxPerTransactionCents: 10_000,
      humanApprovalThresholdCents: null,
    });
    const request = { ...baseRequest, amountCents: 10_000 };
    expect(evaluate(request, policy, baseCtx).decision).toBe(DecisionType.APPROVED);
  });

  test('APPROVED no boundary exato de monthlyBudget (spent + amount == budget)', () => {
    const policy = withRules({ monthlyBudgetCents: 100_000, humanApprovalThresholdCents: null });
    const ctx = { monthlySpentCents: 99_000 };
    const request = { ...baseRequest, amountCents: 1_000 };
    expect(evaluate(request, policy, ctx).decision).toBe(DecisionType.APPROVED);
  });

  test('APPROVED quando todos os limits são null/empty (engine sem restrições)', () => {
    const policy = withRules({
      maxPerTransactionCents: null,
      monthlyBudgetCents: null,
      vendorAllowList: [],
      vendorDenyList: [],
      actionTypes: [],
      humanApprovalThresholdCents: null,
    });
    const request = { ...baseRequest, amountCents: 999_999_999 };
    expect(evaluate(request, policy, baseCtx)).toEqual({ decision: DecisionType.APPROVED });
  });
});

// ---------- REJECTED — actionTypes ----------

describe('evaluate — REJECTED por actionTypes', () => {
  test('REJECTED quando actionType não está na lista', () => {
    const policy = withRules({ actionTypes: ['compute', 'storage'] });
    const result = evaluate(baseRequest, policy, baseCtx);
    expect(isRejected(result)).toBe(true);
    if (isRejected(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.ACTION_TYPES);
      expect(result.reason).toContain('api-call');
    }
  });

  test('APPROVED quando actionType bate (lista não vazia, valor incluso)', () => {
    const policy = withRules({ actionTypes: ['api-call', 'compute'] });
    expect(evaluate(baseRequest, policy, baseCtx).decision).toBe(DecisionType.APPROVED);
  });

  test('actionTypes vazia desabilita o check (qualquer actionType aceito)', () => {
    const policy = withRules({ actionTypes: [] });
    const request = { ...baseRequest, actionType: 'qualquer-coisa-rara' };
    expect(evaluate(request, policy, baseCtx).decision).toBe(DecisionType.APPROVED);
  });
});

// ---------- REJECTED — vendor lists ----------

describe('evaluate — REJECTED por vendor lists', () => {
  test('REJECTED quando vendor em denyList', () => {
    const policy = withRules({ vendorDenyList: [VENDOR_A] });
    const result = evaluate(baseRequest, policy, baseCtx);
    expect(isRejected(result)).toBe(true);
    if (isRejected(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.VENDOR_DENY_LIST);
    }
  });

  test('REJECTED quando vendor NÃO está em allowList não-vazia', () => {
    const policy = withRules({ vendorAllowList: [VENDOR_B, VENDOR_C] });
    const result = evaluate(baseRequest, policy, baseCtx);
    expect(isRejected(result)).toBe(true);
    if (isRejected(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.VENDOR_ALLOW_LIST);
    }
  });

  test('Precedência: denyList vence allowList quando vendor está em ambas', () => {
    const policy = withRules({
      vendorAllowList: [VENDOR_A],
      vendorDenyList: [VENDOR_A],
    });
    const result = evaluate(baseRequest, policy, baseCtx);
    expect(isRejected(result)).toBe(true);
    if (isRejected(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.VENDOR_DENY_LIST);
    }
  });

  test('allowList vazia desabilita o check (vendor não precisa estar listado)', () => {
    const policy = withRules({ vendorAllowList: [], vendorDenyList: [] });
    expect(evaluate(baseRequest, policy, baseCtx).decision).toBe(DecisionType.APPROVED);
  });
});

// ---------- REJECTED — limits ----------

describe('evaluate — REJECTED por limits de valor', () => {
  test('REJECTED quando amount > maxPerTransactionCents', () => {
    const request = { ...baseRequest, amountCents: 15_000 };
    const result = evaluate(request, basePolicy, baseCtx);
    expect(isRejected(result)).toBe(true);
    if (isRejected(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.MAX_PER_TRANSACTION_CENTS);
    }
  });

  test('REJECTED quando monthlySpent + amount > monthlyBudgetCents', () => {
    const ctx = { monthlySpentCents: 99_500 };
    const request = { ...baseRequest, amountCents: 1_000 };
    const result = evaluate(request, basePolicy, ctx);
    expect(isRejected(result)).toBe(true);
    if (isRejected(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.MONTHLY_BUDGET_CENTS);
    }
  });

  test('maxPerTransactionCents null = sem limite por tx', () => {
    const policy = withRules({ maxPerTransactionCents: null, humanApprovalThresholdCents: null });
    const request = { ...baseRequest, amountCents: 50_000 }; // valor maior que monthlyBudget
    // ainda assim, monthlyBudget pode bater — depende do contexto
    const ctx = { monthlySpentCents: 0 };
    // 50_000 <= 100_000 (budget), então APPROVED
    expect(evaluate(request, policy, ctx).decision).toBe(DecisionType.APPROVED);
  });

  test('monthlyBudgetCents null = sem limite mensal (mesmo com spent muito alto)', () => {
    const policy = withRules({
      monthlyBudgetCents: null,
      maxPerTransactionCents: null,
      humanApprovalThresholdCents: null,
    });
    const ctx = { monthlySpentCents: 999_999_999 };
    expect(evaluate(baseRequest, policy, ctx).decision).toBe(DecisionType.APPROVED);
  });
});

// ---------- REQUIRES_APPROVAL ----------

describe('evaluate — REQUIRES_APPROVAL', () => {
  test('REQUIRES_APPROVAL quando amount >= humanApprovalThresholdCents', () => {
    const request = { ...baseRequest, amountCents: 5_000 }; // exatamente o threshold
    const result = evaluate(request, basePolicy, baseCtx);
    expect(isRequiresApproval(result)).toBe(true);
    if (isRequiresApproval(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.HUMAN_APPROVAL_THRESHOLD_CENTS);
    }
  });

  test('REQUIRES_APPROVAL quando amount > humanApprovalThresholdCents (sem violar max)', () => {
    const request = { ...baseRequest, amountCents: 7_500 };
    expect(evaluate(request, basePolicy, baseCtx).decision).toBe(DecisionType.REQUIRES_APPROVAL);
  });

  test('APPROVED quando amount < humanApprovalThresholdCents', () => {
    const request = { ...baseRequest, amountCents: 4_999 };
    expect(evaluate(request, basePolicy, baseCtx).decision).toBe(DecisionType.APPROVED);
  });

  test('humanApprovalThresholdCents null = nunca escala (vai direto pra APPROVED)', () => {
    const policy = withRules({ humanApprovalThresholdCents: null });
    const request = { ...baseRequest, amountCents: 9_999 };
    expect(evaluate(request, policy, baseCtx).decision).toBe(DecisionType.APPROVED);
  });
});

// ---------- REQUIRES_APPROVAL — velocidade de gasto ----------

describe('evaluate — velocidade (escala para humano)', () => {
  test('REQUIRES_APPROVAL quando spentLastHour + amount > maxSpendPerHourCents', () => {
    const policy = withRules({ maxSpendPerHourCents: 20_000, humanApprovalThresholdCents: null });
    const ctx: RuntimeContext = { monthlySpentCents: 0, spentLastHourCents: 19_500, paymentsLastHour: 0 };
    const request = { ...baseRequest, amountCents: 1_000 }; // 19_500 + 1_000 = 20_500 > 20_000
    const result = evaluate(request, policy, ctx);
    expect(isRequiresApproval(result)).toBe(true);
    if (isRequiresApproval(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.MAX_SPEND_PER_HOUR_CENTS);
    }
  });

  test('APPROVED no boundary exato de maxSpendPerHourCents (== cap, strict > não escala)', () => {
    const policy = withRules({ maxSpendPerHourCents: 20_000, humanApprovalThresholdCents: null });
    const ctx: RuntimeContext = { monthlySpentCents: 0, spentLastHourCents: 19_000, paymentsLastHour: 0 };
    const request = { ...baseRequest, amountCents: 1_000 }; // == 20_000
    expect(evaluate(request, policy, ctx).decision).toBe(DecisionType.APPROVED);
  });

  test('REQUIRES_APPROVAL quando paymentsLastHour >= maxPaymentsPerHour', () => {
    const policy = withRules({ maxPaymentsPerHour: 5, humanApprovalThresholdCents: null });
    const ctx: RuntimeContext = { monthlySpentCents: 0, spentLastHourCents: 0, paymentsLastHour: 5 };
    const result = evaluate(baseRequest, policy, ctx);
    expect(isRequiresApproval(result)).toBe(true);
    if (isRequiresApproval(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.MAX_PAYMENTS_PER_HOUR);
    }
  });

  test('APPROVED quando paymentsLastHour < maxPaymentsPerHour', () => {
    const policy = withRules({ maxPaymentsPerHour: 5, humanApprovalThresholdCents: null });
    const ctx: RuntimeContext = { monthlySpentCents: 0, spentLastHourCents: 0, paymentsLastHour: 4 };
    expect(evaluate(baseRequest, policy, ctx).decision).toBe(DecisionType.APPROVED);
  });

  test('maxSpendPerHourCents null = sem limite de velocidade', () => {
    const policy = withRules({ maxSpendPerHourCents: null, humanApprovalThresholdCents: null });
    const ctx: RuntimeContext = { monthlySpentCents: 0, spentLastHourCents: 999_999, paymentsLastHour: 0 };
    expect(evaluate(baseRequest, policy, ctx).decision).toBe(DecisionType.APPROVED);
  });

  test('contadores de hora ausentes no context são tratados como 0', () => {
    const policy = withRules({
      maxSpendPerHourCents: 20_000,
      maxPaymentsPerHour: 5,
      humanApprovalThresholdCents: null,
    });
    // ctx sem os campos de hora → engine usa 0 (?? 0)
    const ctx: RuntimeContext = { monthlySpentCents: 0 };
    expect(evaluate(baseRequest, policy, ctx).decision).toBe(DecisionType.APPROVED);
  });

  test('budget mensal (REJECTED) precede velocidade horária (REQUIRES_APPROVAL)', () => {
    const policy = withRules({
      maxPerTransactionCents: null,
      monthlyBudgetCents: 1_000, // amount=2000 viola → REJECTED
      maxSpendPerHourCents: 100, // também estouraria, mas vem depois
      humanApprovalThresholdCents: null,
    });
    const ctx: RuntimeContext = { monthlySpentCents: 0, spentLastHourCents: 0, paymentsLastHour: 0 };
    const request = { ...baseRequest, amountCents: 2_000 };
    const result = evaluate(request, policy, ctx);
    if (isRejected(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.MONTHLY_BUDGET_CENTS);
    } else {
      throw new Error('esperava REJECTED');
    }
  });

  test('velocidade horária precede humanApprovalThresholdCents', () => {
    const policy = withRules({
      maxSpendPerHourCents: 5_000, // amount=6000 estoura velocidade
      humanApprovalThresholdCents: 1_000, // também escalaria
    });
    const ctx: RuntimeContext = { monthlySpentCents: 0, spentLastHourCents: 0, paymentsLastHour: 0 };
    const request = { ...baseRequest, amountCents: 6_000 };
    const result = evaluate(request, policy, ctx);
    if (isRequiresApproval(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.MAX_SPEND_PER_HOUR_CENTS);
    } else {
      throw new Error('esperava REQUIRES_APPROVAL');
    }
  });
});

// ---------- Precedência (ordem canônica) ----------

describe('evaluate — precedência de checks (ordem canônica)', () => {
  test('actionTypes precede vendorDenyList', () => {
    const policy = withRules({
      actionTypes: ['compute'], // request usa 'api-call' → rejeita aqui primeiro
      vendorDenyList: [VENDOR_A],
    });
    const result = evaluate(baseRequest, policy, baseCtx);
    if (isRejected(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.ACTION_TYPES);
    } else {
      throw new Error('esperava REJECTED');
    }
  });

  test('vendorDenyList precede maxPerTransactionCents', () => {
    const policy = withRules({
      vendorDenyList: [VENDOR_A],
      maxPerTransactionCents: 100, // amount=1000 violaria também
    });
    const result = evaluate(baseRequest, policy, baseCtx);
    if (isRejected(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.VENDOR_DENY_LIST);
    } else {
      throw new Error('esperava REJECTED');
    }
  });

  test('maxPerTransactionCents precede monthlyBudgetCents', () => {
    const policy = withRules({
      maxPerTransactionCents: 500, // amount=1000 viola
      monthlyBudgetCents: 100, // também violaria
    });
    const result = evaluate(baseRequest, policy, baseCtx);
    if (isRejected(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.MAX_PER_TRANSACTION_CENTS);
    } else {
      throw new Error('esperava REJECTED');
    }
  });

  test('monthlyBudgetCents precede humanApprovalThresholdCents (rejeita antes de escalar)', () => {
    const policy = withRules({
      maxPerTransactionCents: null,
      monthlyBudgetCents: 1_000, // amount=2000 viola
      humanApprovalThresholdCents: 100, // também escalaria
    });
    const ctx = { monthlySpentCents: 0 };
    const request = { ...baseRequest, amountCents: 2_000 };
    const result = evaluate(request, policy, ctx);
    if (isRejected(result)) {
      expect(result.ruleHit).toBe(PolicyRuleName.MONTHLY_BUDGET_CENTS);
    } else {
      throw new Error('esperava REJECTED');
    }
  });
});

// ---------- Pureza e determinismo ----------

describe('evaluate — pureza e determinismo', () => {
  test('não muta o input (request, policy, context)', () => {
    const request = { ...baseRequest, metadata: { ticket: 'abc' } };
    const requestSnapshot = JSON.parse(JSON.stringify(request));
    const policySnapshot = JSON.parse(JSON.stringify(basePolicy));
    const ctxSnapshot = JSON.parse(JSON.stringify(baseCtx));

    evaluate(request, basePolicy, baseCtx);

    expect(request).toEqual(requestSnapshot);
    expect(basePolicy).toEqual(policySnapshot);
    expect(baseCtx).toEqual(ctxSnapshot);
  });

  test('mesmas entradas → mesma saída (10 invocações consecutivas)', () => {
    const results = Array.from({ length: 10 }, () =>
      evaluate(baseRequest, basePolicy, baseCtx),
    );
    const first = results[0]!;
    for (const r of results) {
      expect(r).toEqual(first);
    }
  });
});
