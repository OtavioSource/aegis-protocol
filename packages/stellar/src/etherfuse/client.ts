/**
 * EtherfuseClient — wrapper REST do Etherfuse Ramp API.
 *
 * Auth: header `Authorization: <api-key>` (SEM prefixo Bearer).
 *
 * Endpoints (confirmados via regional-starter-pack do ElliotFriend):
 *  - GET  /ramp/assets
 *  - POST /ramp/onboarding-url       — registra customer (UUID gerado pelo cliente)
 *  - GET  /ramp/customer/{id}
 *  - POST /ramp/quote
 *  - POST /ramp/order
 *  - GET  /ramp/order/{id}
 *  - POST /ramp/order/fiat_received  — SANDBOX ONLY, body { orderId }
 *
 * Diferença-chave vs assumido inicialmente: o `customerId` é um UUID gerado
 * pelo CLIENTE e registrado via /ramp/onboarding-url — não vem do dashboard KYB.
 */

import { randomUUID } from 'node:crypto';

import type {
  CreateOrderRequest,
  CreateOrderResponse,
  CreateQuoteRequest,
  CreateQuoteResponse,
  EtherfuseBankAccount,
  EtherfuseCustomerResponse,
  EtherfuseErrorBody,
  EtherfuseOnboardingResponse,
  EtherfuseOrder,
  EtherfuseOrderEnvelope,
  EtherfuseOrderStatus,
  EtherfusePaginated,
  EtherfuseWallet,
  ListAssetsParams,
  ListAssetsResponse,
  RawEtherfuseOrderFields,
  RegisterCustomerParams,
  RegisterCustomerResult,
} from './types.js';

/**
 * Consolida as instruções de depósito de uma order. A Ramp API devolve os
 * campos `deposit*` soltos no objeto da order; aqui agrupamos num único record
 * para persistir/exibir. Se não houver campos `deposit*`, usa `paymentInstructions`.
 */
function normalizePaymentInstructions(
  src: RawEtherfuseOrderFields,
): Record<string, unknown> | undefined {
  const entries = Object.entries({
    depositClabe: src.depositClabe,
    depositAmount: src.depositAmount,
    depositBankName: src.depositBankName,
    depositAccountHolder: src.depositAccountHolder,
    statusPage: src.statusPage,
  }).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length > 0) return Object.fromEntries(entries);
  return src.paymentInstructions;
}

export interface EtherfuseClientOptions {
  /** Base URL: https://api.sand.etherfuse.com (sandbox) ou https://api.etherfuse.com (prod). */
  baseUrl: string;
  /** API key (format: api_sand:... ou api_prod:...). */
  apiKey: string;
  /** Blockchain alvo. Default "stellar". */
  blockchain?: string;
  /** Timeout por request em ms. Default 30000. */
  timeoutMs?: number;
  /** Fetch customizado para testes / polyfills. */
  fetch?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Erro tipado do Etherfuse com statusCode + code para tratamento (ex: 409). */
export class EtherfuseApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'EtherfuseApiError';
  }
}

export class EtherfuseClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly blockchain: string;
  private readonly timeoutMs: number;
  private readonly fetch: typeof fetch;

  constructor(options: EtherfuseClientOptions) {
    if (!options.apiKey) throw new Error('EtherfuseClient: apiKey is required');
    if (!options.baseUrl) throw new Error('EtherfuseClient: baseUrl is required');
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.blockchain = options.blockchain ?? 'stellar';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Detecta sandbox pelo prefixo da API key. */
  get isSandbox(): boolean {
    return this.apiKey.startsWith('api_sand:');
  }

  // ==========================================================================
  // Assets
  // ==========================================================================

  /** GET /ramp/assets — smoke test + descoberta de identifiers. */
  async listAssets(params: ListAssetsParams): Promise<ListAssetsResponse> {
    const qs = new URLSearchParams({
      blockchain: params.blockchain,
      currency: params.currency,
      wallet: params.wallet,
    });
    return await this.request<ListAssetsResponse>('GET', `/ramp/assets?${qs.toString()}`);
  }

  // ==========================================================================
  // Customer onboarding
  // ==========================================================================

  /**
   * Registra um customer no Etherfuse.
   *
   * O `customerId` e `bankAccountId` são UUIDs **gerados pelo cliente** e
   * registrados via POST /ramp/onboarding-url — NÃO vêm do dashboard KYB.
   *
   * Se a publicKey já está registrada, o Etherfuse responde 409 com a
   * mensagem contendo "see org: <uuid>" — o método recupera esse ID.
   */
  async registerCustomer(params: RegisterCustomerParams): Promise<RegisterCustomerResult> {
    const customerId = randomUUID();
    const bankAccountId = randomUUID();

    try {
      const resp = await this.request<EtherfuseOnboardingResponse>(
        'POST',
        '/ramp/onboarding-url',
        {
          customerId,
          bankAccountId,
          publicKey: params.publicKey,
          blockchain: this.blockchain,
        },
      );
      return {
        customerId,
        bankAccountId,
        presignedUrl: resp?.presignedUrl ?? resp?.url ?? null,
        alreadyRegistered: false,
      };
    } catch (err) {
      // 409: publicKey já registrada — extrai customerId existente da mensagem
      if (err instanceof EtherfuseApiError && err.statusCode === 409) {
        const match = err.message.match(/see org:\s*([0-9a-f-]+)/i);
        if (match && match[1]) {
          return {
            customerId: match[1],
            bankAccountId,
            presignedUrl: null,
            alreadyRegistered: true,
          };
        }
      }
      throw err;
    }
  }

  /** GET /ramp/customer/{id} — lookup. Retorna null em 404. */
  async getCustomer(customerId: string): Promise<EtherfuseCustomerResponse | null> {
    try {
      return await this.request<EtherfuseCustomerResponse>(
        'GET',
        `/ramp/customer/${encodeURIComponent(customerId)}`,
      );
    } catch (err) {
      if (err instanceof EtherfuseApiError && err.statusCode === 404) return null;
      throw err;
    }
  }

  // ==========================================================================
  // Wallets & bank accounts
  // ==========================================================================

  /**
   * POST /ramp/wallet — registra (ou restaura, se soft-deleted) uma crypto
   * wallet na org. Sob uma org KYB-aprovada, a wallet já volta com
   * `kycStatus: 'approved'` — pré-requisito para criar orders.
   *
   * `claimOwnership` fica `false`: claim exige a wallet registrada
   * exclusivamente na org, o que falha se ela já existir em outra.
   */
  async registerWallet(publicKey: string): Promise<EtherfuseWallet> {
    return await this.request<EtherfuseWallet>('POST', '/ramp/wallet', {
      publicKey,
      blockchain: this.blockchain,
      claimOwnership: false,
    });
  }

  /** GET /ramp/wallets — lista crypto wallets registradas na org. */
  async listWallets(): Promise<EtherfuseWallet[]> {
    const resp = await this.request<EtherfusePaginated<EtherfuseWallet>>(
      'GET',
      '/ramp/wallets',
    );
    return resp.items ?? [];
  }

  /** GET /ramp/bank-accounts — lista bank accounts da org. */
  async listBankAccounts(): Promise<EtherfuseBankAccount[]> {
    const resp = await this.request<EtherfusePaginated<EtherfuseBankAccount>>(
      'GET',
      '/ramp/bank-accounts',
    );
    return resp.items ?? [];
  }

  // ==========================================================================
  // Quote / Order
  // ==========================================================================

  /** POST /ramp/quote — passo 1 de on-ramp/off-ramp. */
  async createQuote(body: CreateQuoteRequest): Promise<CreateQuoteResponse> {
    return await this.request<CreateQuoteResponse>('POST', '/ramp/quote', body);
  }

  /**
   * POST /ramp/order — passo 2: cria order com o quoteId.
   * `orderId` é gerado pelo cliente (UUID). Response pode vir aninhado em
   * `onramp`/`offramp` — o método normaliza.
   */
  async createOrder(body: CreateOrderRequest): Promise<CreateOrderResponse> {
    const orderId = randomUUID();
    const envelope = await this.request<EtherfuseOrderEnvelope>('POST', '/ramp/order', {
      orderId,
      quoteId: body.quoteId,
      publicKey: body.publicKey,
      bankAccountId: body.bankAccountId,
      memo: body.memo,
    });
    const order = this.normalizeOrder(envelope, orderId);
    return {
      orderId: order.orderId,
      status: order.status,
      paymentInstructions: order.paymentInstructions,
    };
  }

  /** GET /ramp/order/{id} — polling de status. */
  async getOrder(orderId: string): Promise<EtherfuseOrder> {
    const envelope = await this.request<EtherfuseOrderEnvelope>(
      'GET',
      `/ramp/order/${encodeURIComponent(orderId)}`,
    );
    return this.normalizeOrder(envelope, orderId);
  }

  /**
   * POST /ramp/order/fiat_received — SANDBOX ONLY. Body: { orderId }.
   * Simula o usuário tendo pago o fiat (Pix/SPEI). Pitfall #4 do masterclass
   * Stellar 37: "Sandbox parado: POST /ramp/order/fiat_received simula o Pix".
   */
  async simulateFiatReceived(orderId: string): Promise<{ statusCode: number }> {
    if (!this.isSandbox) {
      throw new Error('simulateFiatReceived() só pode ser chamado em sandbox (api_sand:...)');
    }
    const statusCode = await this.requestStatus('POST', '/ramp/order/fiat_received', { orderId });
    return { statusCode };
  }

  // ==========================================================================
  // HTTP internals
  // ==========================================================================

  /**
   * Normaliza envelope de order (aninhado em onramp/offramp ou flat).
   *
   * A Ramp API usa nomes distintos por endpoint: GET /ramp/order/{id} devolve
   * `amountInFiat`/`amountInTokens` e `status` (created|funded|completed);
   * POST /ramp/order devolve `{ onramp: { ...depositClabe/depositBankName } }`
   * sem `status`. Aqui consolidamos tudo no shape `EtherfuseOrder`.
   */
  private normalizeOrder(env: EtherfuseOrderEnvelope, fallbackId: string): EtherfuseOrder {
    const src = env.onramp ?? env.offramp ?? env;
    const status = (src.status ?? 'created') as EtherfuseOrderStatus;
    const tokens = src.amountInTokens ?? src.targetAmount ?? src.destinationAmount;
    return {
      orderId: src.orderId ?? fallbackId,
      status,
      sourceAmount: src.amountInFiat ?? src.sourceAmount,
      targetAmount: tokens,
      actualAmount: status === 'completed' ? (src.actualAmount ?? tokens) : src.actualAmount,
      destinationAmount: src.destinationAmount,
      stellarTxHash: src.stellarTxHash ?? src.stellarTransactionId ?? src.transactionHash,
      stellarTransactionId: src.stellarTransactionId,
      message: src.message,
      createdAt: src.createdAt,
      completedAt: src.completedAt,
      paymentInstructions: normalizePaymentInstructions(src),
    };
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const { text, status, ok } = await this.rawRequest(method, path, body);
    if (!ok) {
      let parsed: EtherfuseErrorBody = {};
      try {
        parsed = JSON.parse(text) as EtherfuseErrorBody;
      } catch {
        // não-JSON
      }
      throw new EtherfuseApiError(
        parsed.error?.message || text || `Etherfuse ${status}`,
        status,
        parsed.error?.code || 'UNKNOWN_ERROR',
      );
    }
    if (text.trim() === '') return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Etherfuse retornou body não-JSON: ${text.slice(0, 200)}`);
    }
  }

  /** Variante que retorna apenas o status code (para simulateFiatReceived). */
  private async requestStatus(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<number> {
    const { status } = await this.rawRequest(method, path, body);
    return status;
  }

  private async rawRequest(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ text: string; status: number; ok: boolean }> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: this.apiKey, // SEM Bearer
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') {
        throw new Error(`Etherfuse request timeout após ${this.timeoutMs}ms (${method} ${url})`);
      }
      throw new Error(`Etherfuse network error (${method} ${url}): ${e.message}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => '');
    return { text, status: response.status, ok: response.ok };
  }
}
