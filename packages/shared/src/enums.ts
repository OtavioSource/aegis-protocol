/**
 * Enums do domínio Aegis Protocol.
 *
 * Mantidos como `const enum` evitado deliberadamente — usamos enums string-baseados
 * para compatibilidade com serialização JSON, debugging e Prisma.
 */

export enum ChainType {
  STELLAR = 'STELLAR',
  // Solana, Base etc. entram apenas quando houver SettlementAdapter implementado
}

export enum UserRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  VIEWER = 'VIEWER',
}

export enum AgentStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REVOKED = 'REVOKED',
}

export enum VendorStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export enum VendorWalletStatus {
  PROVISIONING = 'PROVISIONING',
  ACTIVE = 'ACTIVE',
  SPONSORED_BY_AEGIS = 'SPONSORED_BY_AEGIS',
  INACTIVE = 'INACTIVE',
}

export enum VendorSignMode {
  /** Aegis gera o keypair do vendor e assina em nome dele (default MVP). */
  AEGIS = 'AEGIS',
  /** Vendor fornece publicKey e assina out-of-band (Freighter/LOBSTR). */
  SELF = 'SELF',
}

/**
 * Estado de uma SpendRequest ao longo de seu ciclo de vida.
 * Ver `docs/03-domain-model.md §3.7` (máquina de estado).
 */
export enum SpendRequestStatus {
  CREATED = 'CREATED',
  APPROVED = 'APPROVED',
  REQUIRES_APPROVAL = 'REQUIRES_APPROVAL',
  REJECTED = 'REJECTED',
  APPROVED_BY_HUMAN = 'APPROVED_BY_HUMAN',
  REJECTED_BY_HUMAN = 'REJECTED_BY_HUMAN',
  EXPIRED = 'EXPIRED',
  /**
   * Não-custodial (multisig 5a): a policy aprovou e o Aegis emitiu o envelope
   * canônico (XDR não-assinado); aguardando a assinatura da agent key via
   * `POST /spend-requests/:id/cosign`. Ver ADR 0007 §5.
   */
  AWAITING_AGENT_SIGNATURE = 'AWAITING_AGENT_SIGNATURE',
  EXECUTING = 'EXECUTING',
  EXECUTED = 'EXECUTED',
  EXECUTION_FAILED = 'EXECUTION_FAILED',
}

/** Estado de provisionamento de uma carteira (conta multisig). Ver ADR 0007 §4. */
export enum WalletStatus {
  /** Conta criada no nosso modelo, multisig ainda não configurado on-chain. */
  PROVISIONING = 'PROVISIONING',
  /** Signers + thresholds aplicados on-chain; pronta para receber/gastar. */
  ACTIVE = 'ACTIVE',
}

/** Origem da master key (do dono) de uma carteira. Ver ADR 0007 §7. */
export enum OwnerKeyMode {
  /** Aegis gerou o keypair client-side (secret nunca chegou ao servidor). */
  GENERATED = 'GENERATED',
  /** Dono trouxe a própria wallet (Freighter/LOBSTR) — só a pubkey é informada. */
  EXTERNAL = 'EXTERNAL',
}

/**
 * Resultado da Policy Engine — uma das 3 decisões mutuamente exclusivas.
 * Ver `docs/09-policy-dsl.md §1 P3`.
 */
export enum DecisionType {
  APPROVED = 'APPROVED',
  REQUIRES_APPROVAL = 'REQUIRES_APPROVAL',
  REJECTED = 'REJECTED',
}

/** Ação de aprovação humana sobre uma SpendRequest escalada. */
export enum ApprovalAction {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** Tipos de evento registrados no audit log (DB) + Soroban event. */
export enum EventType {
  DECISION_MADE = 'DECISION_MADE',
  PAYMENT_EXECUTED = 'PAYMENT_EXECUTED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  APPROVAL_REQUESTED = 'APPROVAL_REQUESTED',
  APPROVAL_GRANTED = 'APPROVAL_GRANTED',
  APPROVAL_DENIED = 'APPROVAL_DENIED',
  KILL_SWITCH_ACTIVATED = 'KILL_SWITCH_ACTIVATED',
  FIAT_DEPOSITED = 'FIAT_DEPOSITED',
  FIAT_WITHDRAWN = 'FIAT_WITHDRAWN',
}

/** Estado de uma operação SEP-24 (deposit ou withdraw). */
export enum FiatTransactionStatus {
  INITIATED = 'INITIATED',
  PENDING_USER_INFO = 'PENDING_USER_INFO',
  PENDING_USER_TRANSFER = 'PENDING_USER_TRANSFER',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

/**
 * Identificador das regras do Policy DSL. Usado em `Decision.ruleHit`
 * para que o consumidor possa reagir programaticamente à regra violada.
 * Ver `docs/09-policy-dsl.md §3`.
 */
export enum PolicyRuleName {
  ACTION_TYPES = 'actionTypes',
  VENDOR_DENY_LIST = 'vendorDenyList',
  VENDOR_ALLOW_LIST = 'vendorAllowList',
  MAX_PER_TRANSACTION_CENTS = 'maxPerTransactionCents',
  MONTHLY_BUDGET_CENTS = 'monthlyBudgetCents',
  MAX_SPEND_PER_HOUR_CENTS = 'maxSpendPerHourCents',
  MAX_PAYMENTS_PER_HOUR = 'maxPaymentsPerHour',
  HUMAN_APPROVAL_THRESHOLD_CENTS = 'humanApprovalThresholdCents',
}
