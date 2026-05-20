/**
 * Tipos do Etherfuse Ramp API (proprietário, REST).
 *
 * Docs: https://docs.etherfuse.com
 * Sandbox base: https://api.sand.etherfuse.com
 * Produção base: https://api.etherfuse.com
 *
 * Endpoints (confirmados via regional-starter-pack do ElliotFriend):
 *  - GET  /ramp/assets
 *  - POST /ramp/onboarding-url      (registra customer — customerId é UUID gerado pelo cliente)
 *  - GET  /ramp/customer/{id}
 *  - POST /ramp/customer/{id}/bank-accounts
 *  - POST /ramp/quote
 *  - POST /ramp/order
 *  - GET  /ramp/order/{id}
 *  - POST /ramp/order/fiat_received (sandbox only — body { orderId })
 */

// ============================================================================
// Assets
// ============================================================================

export interface EtherfuseAsset {
  symbol: string;
  /** Identificador "CODE:ISSUER" para assets Stellar. */
  identifier: string;
  currency?: string;
  balance?: string | null;
  decimals?: number;
}

export interface ListAssetsParams {
  blockchain: 'stellar' | string;
  currency: string;
  wallet: string;
}

export interface ListAssetsResponse {
  assets: EtherfuseAsset[];
}

// ============================================================================
// Customer onboarding
// ============================================================================

export interface RegisterCustomerParams {
  /** Public key Stellar do customer (treasury Aegis no MVP). */
  publicKey: string;
}

export interface RegisterCustomerResult {
  /** customerId — UUID gerado pelo cliente e registrado no Etherfuse. */
  customerId: string;
  /** bankAccountId — UUID gerado pelo cliente. */
  bankAccountId: string;
  /** URL presignada para o usuário completar KYC (quando aplicável). */
  presignedUrl: string | null;
  /** true se a publicKey já estava registrada (409 → recuperou ID existente). */
  alreadyRegistered: boolean;
}

export interface EtherfuseOnboardingResponse {
  /** URL presignada de KYC hosted. */
  url?: string;
  presignedUrl?: string;
}

export interface EtherfuseCustomerResponse {
  customerId: string;
  displayName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// Wallets & bank accounts (org-level — descobertos no setup)
// ============================================================================

/** Status de KYC de uma wallet/customer na Ramp API. */
export type EtherfuseKycStatus =
  | 'not_started'
  | 'proposed'
  | 'approved'
  | 'approved_chain_deploying'
  | 'rejected';

/** Crypto wallet registrada na org (GET /ramp/wallets, POST /ramp/wallet). */
export interface EtherfuseWallet {
  walletId: string;
  customerId: string;
  publicKey: string;
  blockchain: string;
  /** Presente na resposta de POST /ramp/wallet; ausente no list. */
  kycStatus?: EtherfuseKycStatus;
  createdAt?: string;
  updatedAt?: string;
}

/** Bank account da org (GET /ramp/bank-accounts). */
export interface EtherfuseBankAccount {
  bankAccountId: string;
  customerId: string;
  currency?: string;
  label?: string;
  /** "active" quando pronta para orders. */
  status?: string;
  compliant?: boolean;
  needsWork?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Envelope paginado padrão da Ramp API. */
export interface EtherfusePaginated<T> {
  items: T[];
  totalItems?: number;
  pageSize?: number;
  pageNumber?: number;
  totalPages?: number;
}

// ============================================================================
// Quote
// ============================================================================

export interface CreateQuoteRequest {
  /** UUID v4 gerado pelo cliente. */
  quoteId: string;
  customerId: string;
  blockchain: 'stellar' | string;
  quoteAssets: {
    type: 'onramp' | 'offramp';
    /** On-ramp: fiat (ex: "USD", "BRL"). Off-ramp: asset Stellar "CODE:ISSUER". */
    sourceAsset: string;
    /** On-ramp: asset Stellar "CODE:ISSUER". Off-ramp: fiat. */
    targetAsset: string;
  };
  /** Valor decimal string na unidade da sourceAsset. */
  sourceAmount: string;
}

export interface CreateQuoteResponse {
  quoteId: string;
  quoteAssets?: {
    type: string;
    sourceAsset: string;
    targetAsset: string;
  };
  sourceAmount?: string;
  destinationAmount?: string;
  destinationAmountAfterFee?: string;
  exchangeRate?: string;
  feeAmount?: string;
  expiresAt?: string;
  createdAt?: string;
}

// ============================================================================
// Order
// ============================================================================

export interface CreateOrderRequest {
  /** quoteId obtido em createQuote. */
  quoteId: string;
  /** Public key Stellar destino (on-ramp) — recebe o asset. */
  publicKey: string;
  /** bankAccountId — necessário para off-ramp; opcional on-ramp. */
  bankAccountId?: string;
  /** Memo opcional (off-ramp exige; on-ramp ignora). */
  memo?: string;
}

export interface CreateOrderResponse {
  orderId: string;
  status: EtherfuseOrderStatus;
  /** Instruções de pagamento (SPEI: clabe; Pix: pixKey; etc.). */
  paymentInstructions?: Record<string, unknown>;
}

/**
 * Status reais observados na Ramp API (sandbox + docs):
 *  - created   — order criada, aguardando o fiat ser pago (Pix/SPEI)
 *  - funded    — fiat recebido, settlement on-chain em andamento
 *  - completed — asset entregue na wallet
 *  - failed / expired — terminais de erro
 */
export type EtherfuseOrderStatus =
  | 'created'
  | 'funded'
  | 'completed'
  | 'failed'
  | 'expired';

export const TERMINAL_ETHERFUSE_STATUSES: ReadonlyArray<EtherfuseOrderStatus> = [
  'completed',
  'failed',
  'expired',
];

export function isTerminalEtherfuseStatus(s: string): boolean {
  return (TERMINAL_ETHERFUSE_STATUSES as readonly string[]).includes(s);
}

export interface EtherfuseOrder {
  orderId: string;
  status: EtherfuseOrderStatus;
  /** Valor pago em fiat (amountInFiat). */
  sourceAmount?: string;
  /** Valor a receber/recebido em asset Stellar (amountInTokens). */
  targetAmount?: string;
  /** Valor efetivamente creditado quando completed. */
  actualAmount?: string;
  destinationAmount?: string;
  /** Hash da tx Stellar quando settle on-chain (ausente no sandbox). */
  stellarTxHash?: string;
  stellarTransactionId?: string;
  message?: string;
  createdAt?: string;
  completedAt?: string;
  paymentInstructions?: Record<string, unknown>;
}

/**
 * Campos crus de uma order como o Etherfuse devolve — usados tanto na forma
 * flat (GET /ramp/order/{id}) quanto aninhada (POST /ramp/order → `onramp`).
 */
export interface RawEtherfuseOrderFields {
  orderId?: string;
  status?: EtherfuseOrderStatus;
  /** Valor fiat (GET retorna `amountInFiat`). */
  amountInFiat?: string;
  /** Valor em asset Stellar (GET retorna `amountInTokens`). */
  amountInTokens?: string;
  sourceAmount?: string;
  targetAmount?: string;
  destinationAmount?: string;
  actualAmount?: string;
  stellarTransactionId?: string;
  stellarTxHash?: string;
  transactionHash?: string;
  message?: string;
  createdAt?: string;
  completedAt?: string;
  /** Página hosted de status da order. */
  statusPage?: string;
  /** Instruções de depósito (flat na resposta da Ramp API). */
  depositClabe?: string;
  depositAmount?: string;
  depositBankName?: string;
  depositAccountHolder?: string;
  paymentInstructions?: Record<string, unknown>;
}

/**
 * Response wrapper do Etherfuse — order pode vir aninhada em `onramp`/`offramp`
 * (POST /ramp/order) ou flat (GET /ramp/order/{id}). Cliente normaliza ambos.
 */
export interface EtherfuseOrderEnvelope extends RawEtherfuseOrderFields {
  onramp?: RawEtherfuseOrderFields & { orderId: string };
  offramp?: RawEtherfuseOrderFields & { orderId: string };
}

// ============================================================================
// Error
// ============================================================================

export interface EtherfuseErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}
