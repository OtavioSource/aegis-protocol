/**
 * Tipos públicos do @aegis/sdk.
 *
 * Sempre que possível, derivados de `@aegis/shared` para garantir
 * coerência com a API.
 */

import type { DecisionType, SpendRequestStatus } from '@aegis/shared';

// ===== AegisClient config =====

export interface AegisClientOptions {
  /** API key do Agent (formato `cr_<32 chars>`). */
  apiKey: string;
  /**
   * Secret Stellar do agente (`S...`) — modelo não-custodial 5a. Usada para
   * co-assinar o envelope de pagamento client-side no fluxo two-phase. Se
   * omitida, `pay()` retorna AWAITING_AGENT_SIGNATURE sem co-assinar (o caller
   * pode assinar manualmente e chamar `cosign()`).
   */
  agentSignerSecret?: string;
  /** URL base da Aegis API. Default: https://api.aegis-protocol.dev */
  baseUrl?: string;
  /** Timeout por request em ms. Default 30000. */
  timeoutMs?: number;
  /** Fetch customizado (testes, polyfills). Default: globalThis.fetch. */
  fetch?: typeof fetch;
  /** Versão da API. Default 'v1'. */
  apiVersion?: string;
}

// ===== Pay / SpendRequest =====

export interface PayInput {
  vendorId: string;
  amountCents: number;
  asset: string;
  actionType: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface PayOptions {
  /**
   * UUID v4 enviado no header `Idempotency-Key`. Se omitido, SDK gera um
   * automaticamente via `crypto.randomUUID()`.
   *
   * Para retry seguro, **reuse a mesma key em chamadas equivalentes** —
   * a API garante que apenas uma cobrança será executada.
   */
  idempotencyKey?: string;
}

/**
 * Resultado de `aegis.pay()`. Sempre representa o estado atual da SpendRequest
 * no momento da resposta.
 */
export interface PayResult {
  id: string;
  status: SpendRequestStatus;
  decision: DecisionType;
  decisionReason: string | null;
  amountCents: number;
  asset: string;
  actionType: string;
  reason: string | null;
  vendorId: string;
  agentId: string;
  policyId: string;
  txHash: string | null;
  ledger: number | null;
  stellarExpertUrl: string | null;
  executedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  evaluatedAt: string | null;
  /**
   * Não-custodial (5a): envelope canônico não-assinado, presente quando
   * `status === 'AWAITING_AGENT_SIGNATURE'`. O agente assina e chama `/cosign`.
   */
  envelopeXdr?: string | null;
  /** Passphrase da network para assinar o `envelopeXdr`. */
  networkPassphrase?: string | null;
}

// ===== List / Get =====

export interface ListSpendRequestsQuery {
  status?: SpendRequestStatus;
  vendorId?: string;
  limit?: number;
}

export interface ListResult<T> {
  data: T[];
}
