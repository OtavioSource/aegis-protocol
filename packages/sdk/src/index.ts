/**
 * @aegis/sdk — cliente TypeScript para agentes consumirem a Aegis API.
 *
 * API principal:
 * - `AegisClient`           — classe de entrada (pay, getSpendRequest, listSpendRequests)
 * - `parsePaymentRequired`  — extrai PaymentRequirements[] do header X-PAYMENT-REQUIRED
 * - `buildPaymentSignature` — constrói o valor do header X-PAYMENT após pagamento
 * - `payX402`               — orquestra parse → pay → assinatura
 * - `X402Error`             — erro tipado do fluxo x402
 *
 * Compatível com Node 22+, Bun, Deno, Cloudflare Workers e edge runtimes.
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
export {
  buildPaymentSignature,
  parsePaymentRequired,
  payX402,
  X402Error,
} from './http-402.js';
export { signEnvelope } from './signer.js';
export type { PaymentPayload, PaymentRequired, PaymentRequirements } from './http-402.js';
export type {
  AegisClientOptions,
  ListResult,
  ListSpendRequestsQuery,
  PayInput,
  PayOptions,
  PayResult,
} from './types.js';

export const SDK_VERSION = '0.0.1';
