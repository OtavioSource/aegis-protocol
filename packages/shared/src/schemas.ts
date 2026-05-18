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
 * - `pathPaymentSlippage` aplica-se quando `Vendor.preferredAsset ≠ USDC` (RF11).
 */
export const PolicyRulesSchema = z.object({
  maxPerTransactionCents: z.number().int().nonnegative().nullable(),
  monthlyBudgetCents: z.number().int().nonnegative().nullable(),
  vendorAllowList: z.array(z.string().uuid()).default([]),
  vendorDenyList: z.array(z.string().uuid()).default([]),
  actionTypes: z.array(z.string().min(1)).default([]),
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
});
