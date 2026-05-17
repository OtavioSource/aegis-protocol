# 09 — Policy DSL

> Linguagem declarativa JSON das políticas que a Engine avalia. Schema versionado via Zod.

---

## 1. Princípios

### P1 — Declarativo, não programático
Políticas são **JSON declarativo**, não scripts. Razões:
- Auditável (humano lê e entende).
- Versionável (diff entre versões é claro).
- Seguro (não permite injeção de código).
- Validable (Zod schema valida formato).
- Determinístico (sem side effects, sem I/O, sem chamadas externas).

### P2 — Ordem de avaliação determinística
A engine **sempre** avalia regras na mesma ordem, documentada. Resultado é totalmente determinístico dado `(request, policy, runtimeContext)`.

### P3 — Decisões mutuamente exclusivas
A engine retorna **exatamente uma** decisão: `APPROVED`, `REQUIRES_APPROVAL`, ou `REJECTED`. Nunca múltiplas, nunca ambígua.

### P4 — Pré-carga de contexto
A engine é pura — não consulta DB. Caller (orchestrator) pré-carrega `RuntimeContext` com: saldo mensal já usado, número de requests pendentes, etc.

---

## 2. Estrutura da Policy

### 2.1 Top-level (versão MVP)

```json
{
  "name": "Default Conservative Policy",
  "version": 1,
  "rules": {
    "maxPerTransactionCents": 50000,
    "monthlyBudgetCents": 100000000,
    "vendorAllowList": [],
    "vendorDenyList": [],
    "actionTypes": ["api-call", "scraping", "compute"],
    "humanApprovalThresholdCents": 20000
  }
}
```

### 2.2 Zod schema (referência canônica)

```ts
// packages/shared/src/schemas/policy.ts
import { z } from "zod";

export const PolicyRulesSchema = z.object({
  maxPerTransactionCents: z.number().int().nonnegative().nullable(),
  monthlyBudgetCents: z.number().int().nonnegative().nullable(),
  vendorAllowList: z.array(z.string().uuid()).default([]),
  vendorDenyList: z.array(z.string().uuid()).default([]),
  actionTypes: z.array(z.string().min(1)).default([]),
  humanApprovalThresholdCents: z.number().int().nonnegative().nullable(),
});

export const PolicySchema = z.object({
  name: z.string().min(1).max(200),
  version: z.number().int().positive(),
  rules: PolicyRulesSchema,
});

export type PolicyRules = z.infer<typeof PolicyRulesSchema>;
export type Policy = z.infer<typeof PolicySchema>;
```

---

## 3. Semântica de cada regra

### 3.1 `maxPerTransactionCents` (int | null)
- **Significado:** valor máximo em centavos USD permitido por transação.
- **`null`:** sem limite.
- **Comportamento:**
  - Se `request.amountCents > maxPerTransactionCents` → `REJECTED` com motivo `"amount exceeds maxPerTransactionCents"`.

### 3.2 `monthlyBudgetCents` (int | null)
- **Significado:** orçamento total que o agente pode gastar no mês corrente (calendário UTC).
- **`null`:** sem limite.
- **Comportamento:**
  - `RuntimeContext.monthlySpentCents` é pré-calculado pelo orchestrator (soma de SpendRequests EXECUTED no mês corrente para esse agente).
  - Se `monthlySpentCents + request.amountCents > monthlyBudgetCents` → `REJECTED` com motivo `"would exceed monthlyBudgetCents"`.

### 3.3 `vendorAllowList` (string[])
- **Significado:** se não vazio, **somente** vendors listados podem receber pagamento.
- **`[]`:** desabilita o check (todos vendors permitidos pelo allowList).
- **Comportamento:**
  - Se `vendorAllowList.length > 0` AND `request.vendorId NOT IN vendorAllowList` → `REJECTED` com motivo `"vendor not in allowList"`.

### 3.4 `vendorDenyList` (string[])
- **Significado:** vendors explicitamente bloqueados.
- **Comportamento:**
  - Se `request.vendorId IN vendorDenyList` → `REJECTED` com motivo `"vendor in denyList"`.

### 3.5 `actionTypes` (string[])
- **Significado:** se não vazio, somente `actionType` listados são permitidos.
- **`[]`:** desabilita o check (qualquer actionType permitido).
- **Comportamento:**
  - Se `actionTypes.length > 0` AND `request.actionType NOT IN actionTypes` → `REJECTED` com motivo `"actionType not allowed"`.

### 3.6 `humanApprovalThresholdCents` (int | null)
- **Significado:** acima deste valor, request **não pode ser aprovada automaticamente** — escala para humano.
- **`null`:** desabilita (toda request passa pela engine).
- **Comportamento:**
  - Se passou todos checks de rejeição AND `request.amountCents >= humanApprovalThresholdCents` → `REQUIRES_APPROVAL`.

---

## 4. Ordem de avaliação (canônica)

```mermaid
flowchart TD
    Start([Start: SpendRequest in])
    R1{actionType in actionTypes?<br/>(if list non-empty)}
    R2{vendor in denyList?}
    R3{vendor in allowList?<br/>(if list non-empty)}
    R4{amount > maxPerTransactionCents?}
    R5{monthlySpent + amount > monthlyBudgetCents?}
    R6{amount >= humanApprovalThresholdCents?}

    R1 -- No --> Reject1[REJECTED: actionType not allowed]
    R1 -- Yes --> R2
    R2 -- Yes --> Reject2[REJECTED: vendor in denyList]
    R2 -- No --> R3
    R3 -- No --> Reject3[REJECTED: vendor not in allowList]
    R3 -- Yes --> R4
    R4 -- Yes --> Reject4[REJECTED: amount exceeds maxPerTransactionCents]
    R4 -- No --> R5
    R5 -- Yes --> Reject5[REJECTED: would exceed monthlyBudgetCents]
    R5 -- No --> R6
    R6 -- Yes --> Escalate[REQUIRES_APPROVAL: above humanApprovalThresholdCents]
    R6 -- No --> Approve[APPROVED]

    Start --> R1
```

**Ordem fixa.** Toda implementação deve seguir esta sequência. Testes verificam.

---

## 5. RuntimeContext (input adicional da engine)

A engine precisa de informação computada externamente para avaliar `monthlyBudgetCents`:

```ts
// packages/shared/src/schemas/runtimeContext.ts
export const RuntimeContextSchema = z.object({
  monthlySpentCents: z.number().int().nonnegative(),
  // futuras: dailySpentCents, hourlyRateLimit, etc.
});

export type RuntimeContext = z.infer<typeof RuntimeContextSchema>;
```

Orchestrator calcula via SQL:
```sql
SELECT COALESCE(SUM(amount_cents), 0)
FROM spend_request
WHERE agent_id = $1
  AND status = 'EXECUTED'
  AND executed_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC');
```

---

## 6. Função `evaluate` (assinatura canônica)

```ts
// packages/policy-engine/src/evaluate.ts

import { Policy, PolicyRules } from "@aegis/shared";
import { SpendRequestInput } from "@aegis/shared";
import { RuntimeContext } from "@aegis/shared";

export type Decision =
  | { decision: "APPROVED" }
  | { decision: "REQUIRES_APPROVAL"; reason: string; ruleHit: string }
  | { decision: "REJECTED"; reason: string; ruleHit: string };

export function evaluate(
  request: SpendRequestInput,
  policy: Policy,
  context: RuntimeContext,
): Decision {
  const r = policy.rules;

  // 1. actionType
  if (r.actionTypes.length > 0 && !r.actionTypes.includes(request.actionType)) {
    return {
      decision: "REJECTED",
      reason: `actionType '${request.actionType}' not in policy.actionTypes`,
      ruleHit: "actionTypes",
    };
  }

  // 2. vendor denyList
  if (r.vendorDenyList.includes(request.vendorId)) {
    return {
      decision: "REJECTED",
      reason: `vendor ${request.vendorId} is in denyList`,
      ruleHit: "vendorDenyList",
    };
  }

  // 3. vendor allowList
  if (r.vendorAllowList.length > 0 && !r.vendorAllowList.includes(request.vendorId)) {
    return {
      decision: "REJECTED",
      reason: `vendor ${request.vendorId} not in allowList`,
      ruleHit: "vendorAllowList",
    };
  }

  // 4. maxPerTransactionCents
  if (r.maxPerTransactionCents != null && request.amountCents > r.maxPerTransactionCents) {
    return {
      decision: "REJECTED",
      reason: `amount ${request.amountCents} exceeds maxPerTransactionCents ${r.maxPerTransactionCents}`,
      ruleHit: "maxPerTransactionCents",
    };
  }

  // 5. monthlyBudgetCents
  if (r.monthlyBudgetCents != null) {
    const wouldSpend = context.monthlySpentCents + request.amountCents;
    if (wouldSpend > r.monthlyBudgetCents) {
      return {
        decision: "REJECTED",
        reason: `would spend ${wouldSpend} exceeds monthlyBudgetCents ${r.monthlyBudgetCents}`,
        ruleHit: "monthlyBudgetCents",
      };
    }
  }

  // 6. humanApprovalThresholdCents (escalate, não rejeita)
  if (r.humanApprovalThresholdCents != null
      && request.amountCents >= r.humanApprovalThresholdCents) {
    return {
      decision: "REQUIRES_APPROVAL",
      reason: `amount ${request.amountCents} >= humanApprovalThresholdCents ${r.humanApprovalThresholdCents}`,
      ruleHit: "humanApprovalThresholdCents",
    };
  }

  return { decision: "APPROVED" };
}
```

**Características críticas:**
- **Pura:** sem `await`, sem I/O, sem `Date.now()`, sem `Math.random()`.
- **Determinística:** mesmas entradas → mesma saída sempre.
- **Síncrona:** retorna direto, sem Promise.
- **Type-safe:** retorno é discriminated union; consumer faz exhaustive match.

---

## 7. Casos de teste de referência

Mínimo de testes no `packages/policy-engine/src/__tests__/evaluate.test.ts`. Servem como contrato vivo do comportamento.

```ts
import { evaluate } from "../evaluate";

const basePolicy = {
  name: "Test",
  version: 1,
  rules: {
    maxPerTransactionCents: 10000,
    monthlyBudgetCents: 100000,
    vendorAllowList: [],
    vendorDenyList: [],
    actionTypes: [],
    humanApprovalThresholdCents: 5000,
  },
};

const baseRequest = {
  vendorId: "vendor-1",
  amountCents: 1000,
  asset: "USDC",
  actionType: "api-call",
};

const baseCtx = { monthlySpentCents: 0 };

describe("evaluate", () => {
  test("APPROVED in normal case", () => {
    expect(evaluate(baseRequest, basePolicy, baseCtx)).toEqual({
      decision: "APPROVED",
    });
  });

  test("REJECTED if actionType not in list", () => {
    const p = { ...basePolicy, rules: { ...basePolicy.rules, actionTypes: ["compute"] } };
    expect(evaluate(baseRequest, p, baseCtx).decision).toBe("REJECTED");
  });

  test("REJECTED if vendor in denyList", () => {
    const p = { ...basePolicy, rules: { ...basePolicy.rules, vendorDenyList: ["vendor-1"] } };
    expect(evaluate(baseRequest, p, baseCtx).decision).toBe("REJECTED");
  });

  test("REJECTED if vendor not in allowList (when allowList non-empty)", () => {
    const p = { ...basePolicy, rules: { ...basePolicy.rules, vendorAllowList: ["vendor-2"] } };
    expect(evaluate(baseRequest, p, baseCtx).decision).toBe("REJECTED");
  });

  test("APPROVED if vendor in allowList", () => {
    const p = { ...basePolicy, rules: { ...basePolicy.rules, vendorAllowList: ["vendor-1"] } };
    expect(evaluate(baseRequest, p, baseCtx).decision).toBe("APPROVED");
  });

  test("REJECTED if amount > maxPerTransactionCents", () => {
    const r = { ...baseRequest, amountCents: 15000 };
    expect(evaluate(r, basePolicy, baseCtx).decision).toBe("REJECTED");
  });

  test("REQUIRES_APPROVAL if amount above threshold but below max", () => {
    const r = { ...baseRequest, amountCents: 7000 };
    expect(evaluate(r, basePolicy, baseCtx).decision).toBe("REQUIRES_APPROVAL");
  });

  test("REJECTED if would exceed monthlyBudgetCents", () => {
    const ctx = { monthlySpentCents: 99500 };
    const r = { ...baseRequest, amountCents: 1000 };
    expect(evaluate(r, basePolicy, ctx).decision).toBe("REJECTED");
  });

  test("APPROVED at exact maxPerTransactionCents boundary", () => {
    const r = { ...baseRequest, amountCents: 10000 };
    expect(evaluate(r, basePolicy, baseCtx).decision).toBe("REJECTED"); // > strict
  });

  test("APPROVED at maxPerTransactionCents - 1", () => {
    const r = { ...baseRequest, amountCents: 9999 };
    const p = { ...basePolicy, rules: { ...basePolicy.rules, humanApprovalThresholdCents: null } };
    expect(evaluate(r, p, baseCtx).decision).toBe("APPROVED");
  });

  test("monthly budget null = unlimited", () => {
    const p = { ...basePolicy, rules: { ...basePolicy.rules, monthlyBudgetCents: null } };
    const ctx = { monthlySpentCents: 999999999 };
    expect(evaluate(baseRequest, p, ctx).decision).not.toBe("REJECTED");
  });

  test("all checks null/empty = always APPROVED for any amount under max", () => {
    const p = {
      ...basePolicy,
      rules: {
        maxPerTransactionCents: null,
        monthlyBudgetCents: null,
        vendorAllowList: [],
        vendorDenyList: [],
        actionTypes: [],
        humanApprovalThresholdCents: null,
      },
    };
    expect(evaluate(baseRequest, p, baseCtx)).toEqual({ decision: "APPROVED" });
  });

  test("vendor denyList takes precedence over allowList", () => {
    const p = {
      ...basePolicy,
      rules: {
        ...basePolicy.rules,
        vendorAllowList: ["vendor-1"],
        vendorDenyList: ["vendor-1"], // contraditório → deny vence
      },
    };
    expect(evaluate(baseRequest, p, baseCtx).decision).toBe("REJECTED");
  });

  test("threshold null = never escalates", () => {
    const p = { ...basePolicy, rules: { ...basePolicy.rules, humanApprovalThresholdCents: null } };
    const r = { ...baseRequest, amountCents: 9999 };
    expect(evaluate(r, p, baseCtx).decision).toBe("APPROVED");
  });
});
```

**Mínimo 15 casos para considerar engine validada (RNF1).**

---

## 8. Exemplos práticos de policies

### 8.1 "Sandbox" — agente novo
```json
{
  "name": "Sandbox - new agent",
  "rules": {
    "maxPerTransactionCents": 500,
    "monthlyBudgetCents": 10000,
    "vendorAllowList": ["openai-vendor-id"],
    "vendorDenyList": [],
    "actionTypes": ["api-call"],
    "humanApprovalThresholdCents": 100
  }
}
```
Permite apenas chamadas API até $5 cada, max $100/mês, e qualquer coisa acima de $1 vai pra humano.

### 8.2 "Production trusted"
```json
{
  "name": "Production trusted CS agent",
  "rules": {
    "maxPerTransactionCents": 50000,
    "monthlyBudgetCents": 5000000,
    "vendorAllowList": [],
    "vendorDenyList": ["risky-vendor-id"],
    "actionTypes": ["api-call", "compute", "scraping"],
    "humanApprovalThresholdCents": 20000
  }
}
```
Limite $500/tx, $50k/mês, todos vendors exceto a denyList, escalonar acima de $200.

### 8.3 "Maximum control" — auditoria
```json
{
  "name": "Audit mode - every spend reviewed",
  "rules": {
    "maxPerTransactionCents": 100000,
    "monthlyBudgetCents": null,
    "vendorAllowList": [],
    "vendorDenyList": [],
    "actionTypes": [],
    "humanApprovalThresholdCents": 1
  }
}
```
Threshold 1 centavo → todas as requests escalam para aprovação humana. Útil temporariamente durante incidente.

---

## 9. Roadmap futuro (NÃO no MVP)

Capabilities pensadas para versões futuras da DSL. **Não implementar no MVP.**

| Feature | Descrição |
|---------|-----------|
| `dailyBudgetCents` | Limite por dia (além de mensal) |
| `hourlyRateLimit` | Max N requests/hora |
| `requireApprovalForVendors` | Lista de vendors que sempre escalam para humano |
| `requireApprovalForActionTypes` | Lista de actionTypes que sempre escalam |
| `timeWindows` | Permitir gastos apenas em horário comercial, dias úteis, etc |
| `velocityChecks` | Detectar mudança brusca de padrão (>3σ do histórico) |
| `vendorCategories` | Categorizar vendors (LLM, infra, data, etc) com budgets por categoria |
| `requireMetadataFields` | Forçar agente a enviar campos específicos (ex: `ticketId` obrigatório) |
| `costPerRequest` | Limite estimado em USD por request unitária |

Cada adição vira nova `Policy.version`; versões antigas continuam válidas (immutability).

---

## 10. ADR relacionado

- [`docs/adr/0006-policy-engine-puro-sem-io.md`](adr/0006-policy-engine-puro-sem-io.md) — justifica desenho puro.
