/**
 * Zod schemas para validação na borda da API e definição canônica do shape
 * dos tipos. Tipos TypeScript são derivados via `z.infer<typeof ...>` em
 * `types.ts` — schemas são a fonte de verdade para evitar divergência.
 *
 * Referências:
 * - docs/09-policy-dsl.md §2.2 (PolicyRulesSchema)
 * - docs/07-api-contract.md §3.1 (POST /spend-requests body)
 */

import { z } from 'zod';

/**
 * Regras do Policy DSL.
 *
 * Semântica de cada regra está documentada em `docs/09-policy-dsl.md §3`.
 *
 * - `*Cents` campos com valor `null` significam "sem limite".
 * - `vendorAllowList = []` desabilita o check (todos vendors permitidos).
 * - `vendorDenyList` é avaliada antes de allowList (deny vence).
 * - `actionTypes = []` desabilita o check (qualquer actionType permitido).
 * - `maxSpendPerHourCents` / `maxPaymentsPerHour` são limites de **velocidade**:
 *   ao exceder, a decisão **escala para humano** (`REQUIRES_APPROVAL`) em vez de
 *   rejeitar — contém agente em loop sem quebrar workloads legítimos de alto
 *   volume. `null` = sem limite. `default(null)` mantém compat com policies
 *   antigas que não têm o campo.
 * - `pathPaymentSlippage` aplica-se quando `Vendor.preferredAsset ≠ USDC` (RF11).
 */
export const PolicyRulesSchema = z.object({
  maxPerTransactionCents: z.number().int().nonnegative().nullable(),
  monthlyBudgetCents: z.number().int().nonnegative().nullable(),
  vendorAllowList: z.array(z.string().uuid()).default([]),
  vendorDenyList: z.array(z.string().uuid()).default([]),
  actionTypes: z.array(z.string().min(1)).default([]),
  /** Teto de gasto na última 1h (centavos). Exceder → REQUIRES_APPROVAL. */
  maxSpendPerHourCents: z.number().int().nonnegative().nullable().default(null),
  /** Teto de nº de pagamentos EXECUTED na última 1h. Exceder → REQUIRES_APPROVAL. */
  maxPaymentsPerHour: z.number().int().nonnegative().nullable().default(null),
  humanApprovalThresholdCents: z.number().int().nonnegative().nullable(),
  pathPaymentSlippage: z.number().min(0).max(1).optional(),
});

/** Policy completa com metadata (id, name, version). */
export const PolicySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  version: z.number().int().positive(),
  rules: PolicyRulesSchema,
});

/**
 * Payload do `POST /spend-requests`. Validado na borda da API; engine recebe
 * a forma já tipada.
 */
export const SpendRequestInputSchema = z.object({
  vendorId: z.string().uuid(),
  /**
   * Opcional: agente "em nome de quem" o spend é submetido. Usado pelo dashboard,
   * que autentica com uma service key e precisa atribuir o spend a um agent
   * específico escolhido na UI. Se omitido, o agent do Bearer token é usado.
   * Só é aceito se pertencer à mesma Company do caller.
   */
  agentId: z.string().uuid().optional(),
  amountCents: z.number().int().positive(),
  /** Asset code curto: "USDC", "EURC", "BRL", "XLM", etc. */
  asset: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Z0-9]+$/, 'asset code deve ser uppercase alfanumérico'),
  /** Tipo de ação livre, validado contra `Policy.rules.actionTypes` quando configurado. */
  actionType: z.string().min(1).max(64),
  reason: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Contexto runtime pré-carregado pelo orchestrator (`apps/api`) antes de
 * invocar a engine. A engine é pura — todos os dados que dependem do estado
 * (saldo mensal, contadores) precisam vir aqui.
 *
 * Ver `docs/09-policy-dsl.md §5`.
 */
export const RuntimeContextSchema = z.object({
  /**
   * Total já gasto no mês corrente (UTC) por este agente, em centavos.
   * Computado via:
   *   SELECT COALESCE(SUM(amount_cents), 0) FROM spend_request
   *   WHERE agent_id = $1
   *     AND status = 'EXECUTED'
   *     AND executed_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC');
   */
  monthlySpentCents: z.number().int().nonnegative(),
  /**
   * Total gasto na última 1h (rolling window) por este agente, em centavos.
   * Alimenta a regra de velocidade `maxSpendPerHourCents`.
   *   WHERE agent_id = $1 AND status = 'EXECUTED' AND executed_at >= NOW() - INTERVAL '1 hour'
   * Opcional: ausente → tratado como 0 pela engine (regra só dispara se a policy
   * tiver o cap configurado, e aí o orchestrator sempre fornece o valor).
   */
  spentLastHourCents: z.number().int().nonnegative().optional(),
  /**
   * Nº de pagamentos EXECUTED na última 1h por este agente.
   * Alimenta a regra de velocidade `maxPaymentsPerHour`. Opcional (ver acima).
   */
  paymentsLastHour: z.number().int().nonnegative().optional(),
});
