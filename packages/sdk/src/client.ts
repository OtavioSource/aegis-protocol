/**
 * AegisClient — cliente HTTP para a Aegis API.
 *
 * Uso típico (agentes):
 *
 * ```ts
 * import { AegisClient } from '@aegis/sdk';
 *
 * const aegis = new AegisClient({
 *   apiKey: process.env.AEGIS_API_KEY!,
 *   baseUrl: 'https://api.aegis-protocol.dev',
 * });
 *
 * const result = await aegis.pay({
 *   vendorId: '...',
 *   amountCents: 1500,
 *   asset: 'USDC',
 *   actionType: 'api-call',
 *   reason: 'LLM call for ticket #4567',
 * });
 *
 * if (result.status === 'EXECUTED') {
 *   console.log('Paid:', result.txHash);
 * }
 * ```
 *
 * Compatível com Node 22+, Bun, Deno, Cloudflare Workers e edge runtimes
 * (usa `fetch` global, zero deps).
 */

import { errorFromResponse, NetworkError } from './errors.js';
import { signEnvelope } from './signer.js';
import type {
  AegisClientOptions,
  ListResult,
  ListSpendRequestsQuery,
  PayInput,
  PayOptions,
  PayResult,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.aegis-protocol.dev';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_API_VERSION = 'v1';

export class AegisClient {
  private readonly apiKey: string;
  private readonly agentSignerSecret?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetch: typeof fetch;
  private readonly apiVersion: string;

  constructor(options: AegisClientOptions) {
    if (!options.apiKey || !options.apiKey.startsWith('cr_')) {
      throw new Error('AegisClient: apiKey is required and must start with "cr_"');
    }
    this.apiKey = options.apiKey;
    this.agentSignerSecret = options.agentSignerSecret;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
  }

  // ===== Spend Requests =====

  /**
   * Solicita um pagamento (modelo não-custodial 5a — ADR 0007).
   *
   * Two-phase automático: cria a spend-request; se a policy aprovar, o Aegis
   * devolve `AWAITING_AGENT_SIGNATURE` + `envelopeXdr`. Com `agentSignerSecret`
   * configurado, o SDK assina o envelope e chama `/cosign` por baixo, retornando
   * o resultado final (EXECUTED / EXECUTION_FAILED). Sem a secret, retorna
   * `AWAITING_AGENT_SIGNATURE` (assine com `cosign()` manualmente).
   *
   * Status code mapping:
   * - 200/201 → APPROVED → envelope emitido (e co-assinado se houver secret)
   * - 202     → REQUIRES_APPROVAL (aguardando humano)
   * - 422     → REJECTED → lança `PolicyRejectedError`
   * - 409     → conflito idempotency → lança `IdempotencyConflictError`
   * - 429     → rate limit → lança `RateLimitError`
   */
  async pay(input: PayInput, options: PayOptions = {}): Promise<PayResult> {
    const idempotencyKey = options.idempotencyKey ?? this.generateIdempotencyKey();
    const result = await this.request<PayResult>('POST', '/spend-requests', {
      headers: { 'Idempotency-Key': idempotencyKey },
      body: input,
    });

    // Two-phase: se aprovado e há secret + envelope, co-assina automaticamente.
    if (
      result.status === 'AWAITING_AGENT_SIGNATURE' &&
      result.envelopeXdr &&
      this.agentSignerSecret
    ) {
      return await this.cosign(result.id, {
        envelopeXdr: result.envelopeXdr,
        networkPassphrase: result.networkPassphrase ?? undefined,
      });
    }
    return result;
  }

  /**
   * Fase 2 do fluxo não-custodial: assina o envelope com a agent key e submete
   * ao `/cosign`. Normalmente chamado automaticamente por `pay()`; exposto para
   * quem quer assinar manualmente (ex.: sem `agentSignerSecret` no client).
   *
   * Se `envelope.envelopeXdr` não for fornecido, busca a spend-request por id.
   */
  async cosign(
    spendRequestId: string,
    envelope?: { envelopeXdr?: string; networkPassphrase?: string; signedXdr?: string },
  ): Promise<PayResult> {
    let signedXdr = envelope?.signedXdr;
    if (!signedXdr) {
      let xdr = envelope?.envelopeXdr;
      let passphrase = envelope?.networkPassphrase;
      if (!xdr || !passphrase) {
        const sr = await this.getSpendRequest(spendRequestId);
        xdr = xdr ?? sr.envelopeXdr ?? undefined;
        passphrase = passphrase ?? sr.networkPassphrase ?? undefined;
      }
      if (!xdr || !passphrase) {
        throw new Error('cosign: envelopeXdr/networkPassphrase indisponíveis para esta spend-request.');
      }
      if (!this.agentSignerSecret) {
        throw new Error('cosign: agentSignerSecret não configurado e signedXdr não fornecido.');
      }
      signedXdr = signEnvelope(xdr, passphrase, this.agentSignerSecret);
    }
    return await this.request<PayResult>(
      'POST',
      `/spend-requests/${encodeURIComponent(spendRequestId)}/cosign`,
      { body: { signedXdr } },
    );
  }

  /** GET /v1/spend-requests/:id */
  async getSpendRequest(id: string): Promise<PayResult> {
    return await this.request<PayResult>('GET', `/spend-requests/${encodeURIComponent(id)}`);
  }

  /** GET /v1/spend-requests */
  async listSpendRequests(query: ListSpendRequestsQuery = {}): Promise<ListResult<PayResult>> {
    const qs = new URLSearchParams();
    if (query.status) qs.set('status', query.status);
    if (query.vendorId) qs.set('vendorId', query.vendorId);
    if (query.limit) qs.set('limit', String(query.limit));
    const suffix = qs.toString();
    return await this.request<ListResult<PayResult>>(
      'GET',
      `/spend-requests${suffix ? `?${suffix}` : ''}`,
    );
  }

  // ===== Utilities =====

  /** Gera um UUID v4 para usar como Idempotency-Key. */
  generateIdempotencyKey(): string {
    return globalThis.crypto.randomUUID();
  }

  /** Public key da treasury (via GET /healthz). Útil para debug. */
  async getTreasuryPublicKey(): Promise<string | null> {
    const data = await this.requestRaw<{ treasuryPublicKey?: string }>('GET', '/healthz', {
      skipApiVersion: true,
      skipAuth: true,
    });
    return data.treasuryPublicKey ?? null;
  }

  // ===== Internal =====

  private async request<T>(
    method: string,
    path: string,
    options: { headers?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    return await this.requestRaw<T>(method, path, options);
  }

  private async requestRaw<T>(
    method: string,
    path: string,
    options: {
      headers?: Record<string, string>;
      body?: unknown;
      skipApiVersion?: boolean;
      skipAuth?: boolean;
    } = {},
  ): Promise<T> {
    const prefix = options.skipApiVersion ? '' : `/${this.apiVersion}`;
    const url = `${this.baseUrl}${prefix}${path}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };
    if (!options.skipAuth) headers['Authorization'] = `Bearer ${this.apiKey}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') {
        throw new NetworkError(`Request timeout after ${this.timeoutMs}ms (${method} ${url})`, err);
      }
      throw new NetworkError(`Network failure (${method} ${url}): ${e.message}`, err);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw await errorFromResponse(response);
    }

    // No content
    if (response.status === 204) return undefined as T;

    return (await response.json()) as T;
  }
}
