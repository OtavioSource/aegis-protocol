/**
 * @aegis/sdk — cliente TypeScript para agentes consumirem a Aegis API.
 *
 * API principal:
 * - `AegisClient`  — classe de entrada (pay, getSpendRequest, listSpendRequests)
 * - `parseHttp402` — extrai Invoice de Response 402
 * - `payInvoice`   — paga Invoice via vendorId cadastrado
 *
 * Compatível com Node 22+, Bun, Deno, Cloudflare Workers e edge runtimes.
 * Zero dependencies (usa fetch global).
 *
 * Ver `docs/07-api-contract.md §5` para spec do contrato e exemplos.
 */

export { AegisClient } from './client.js';
export {
  AegisError,
  ConflictError,
  errorFromResponse,
  ForbiddenError,
  IdempotencyConflictError,
  InternalError,
  NetworkError,
  NotFoundError,
  PolicyRejectedError,
  RateLimitError,
  StellarError,
  UnauthorizedError,
  ValidationError,
} from './errors.js';
export { parseHttp402, payInvoice } from './http-402.js';
export type {
  AegisClientOptions,
  Http402Invoice,
  ListResult,
  ListSpendRequestsQuery,
  PayInput,
  PayInvoiceOptions,
  PayOptions,
  PayResult,
} from './types.js';

export const SDK_VERSION = '0.0.1';
