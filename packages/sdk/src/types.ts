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
}

// ===== HTTP 402 =====

/**
 * Invoice de pagamento extraída de uma resposta HTTP 402.
 *
 * Aegis tenta normalizar vários formatos (x402 Coinbase, JSON genérico, etc.)
 * para esse shape único. Se um campo não estiver presente, `null`.
 */
export interface Http402Invoice {
  /** Quanto cobrar, em centavos. */
  amountCents: number;
  /** Asset code (USDC, EURC, etc.). Default: 'USDC'. */
  asset: string;
  /**
   * Public key Stellar do destinatário. **Nota:** Aegis ignora este campo
   * (paga para o `vendorId` cadastrado). Mantido para debug.
   */
  recipient: string | null;
  /** Memo opcional sugerido pelo vendor (ex: invoice id). */
  memo: string | null;
  /** URL/endpoint original que retornou 402 (debug). */
  source: string | null;
  /** Network sugerido (testnet/mainnet/etc.). */
  network: string | null;
  /** Body original parseado, para inspeção avançada. */
  raw: Record<string, unknown>;
}

/** Opções de `payInvoice` — vendor precisa estar cadastrado por id. */
export interface PayInvoiceOptions extends PayOptions {
  /** Vendor cadastrado correspondente ao invoice. */
  vendorId: string;
  /** Tipo de ação (validado contra Policy). */
  actionType: string;
  /** Motivo humano (free-text). */
  reason?: string;
  /** Metadata extra (passa pra audit log). */
  metadata?: Record<string, unknown>;
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
