import { DecisionType, PolicyRuleName } from './enums.js';

/**
 * Decisão emitida pela Policy Engine — discriminated union.
 *
 * Características:
 * - Mutuamente exclusiva: exatamente uma das 3 variantes.
 * - `APPROVED` não carrega motivo (não há nada a justificar).
 * - `REQUIRES_APPROVAL` e `REJECTED` carregam `reason` (humano-legível) e
 *   `ruleHit` (machine-readable: nome canônico da regra violada).
 *
 * Use exhaustive match para consumir:
 *
 * ```ts
 * switch (decision.decision) {
 *   case DecisionType.APPROVED: return executePayment();
 *   case DecisionType.REQUIRES_APPROVAL: return enqueueApproval(decision.reason);
 *   case DecisionType.REJECTED: return rejectWith(decision.reason);
 * }
 * ```
 *
 * Ver `docs/09-policy-dsl.md §6`.
 */
export type Decision =
  | { decision: DecisionType.APPROVED }
  | {
      decision: DecisionType.REQUIRES_APPROVAL;
      reason: string;
      ruleHit: PolicyRuleName;
    }
  | {
      decision: DecisionType.REJECTED;
      reason: string;
      ruleHit: PolicyRuleName;
    };

/** Type guards para consumo seguro de `Decision`. */
export const isApproved = (d: Decision): d is { decision: DecisionType.APPROVED } =>
  d.decision === DecisionType.APPROVED;

export const isRequiresApproval = (
  d: Decision,
): d is { decision: DecisionType.REQUIRES_APPROVAL; reason: string; ruleHit: PolicyRuleName } =>
  d.decision === DecisionType.REQUIRES_APPROVAL;

export const isRejected = (
  d: Decision,
): d is { decision: DecisionType.REJECTED; reason: string; ruleHit: PolicyRuleName } =>
  d.decision === DecisionType.REJECTED;
