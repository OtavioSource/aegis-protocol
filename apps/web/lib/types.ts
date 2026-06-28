/** Shapes das respostas da Aegis API consumidas pelo dashboard. */

export type SpendRequest = {
  id: string;
  status: string;
  decision: string | null;
  decisionReason: string | null;
  amountCents: number;
  asset: string;
  actionType: string;
  reason: string | null;
  vendorId: string | null;
  agentId: string;
  policyId: string | null;
  txHash: string | null;
  ledger: number | null;
  stellarExpertUrl: string | null;
  createdAt: string;
  evaluatedAt: string | null;
  executedAt: string | null;
  failureReason: string | null;
};

export type Policy = {
  id: string;
  name: string;
  version: number;
  rules: {
    maxPerTransactionCents: number | null;
    monthlyBudgetCents: number | null;
    humanApprovalThresholdCents: number | null;
    maxSpendPerHourCents: number | null;
    maxPaymentsPerHour: number | null;
    actionTypes: string[];
    vendorAllowList: string[];
    vendorDenyList: string[];
  };
  isActive: boolean;
  createdAt: string;
};

export type Agent = {
  id: string;
  name: string;
  description: string | null;
  apiKeyPrefix: string;
  activePolicyId: string;
  walletId: string | null;
  signerPubKey: string | null;
  status: string;
  createdAt: string;
  revokedAt: string | null;
};

/** Carteira não-custodial multisig (ADR 0007). */
export type Wallet = {
  id: string;
  label: string;
  network: string;
  address: string;
  ownerKeyMode: 'GENERATED' | 'EXTERNAL';
  aegisSignerPubKey: string;
  status: 'PROVISIONING' | 'ACTIVE';
  setupTxHash: string | null;
  createdAt: string;
  /** Saldo on-chain (null se a conta ainda não existe). */
  balances?: { usdc: string; xlm: string } | null;
};

export type VendorWallet = {
  id: string;
  publicKey: string;
  status: string;
  isPrimary: boolean;
  chain: string;
};

export type Vendor = {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  category: string | null;
  contactEmail: string | null;
  preferredAsset: string;
  status: string;
  createdAt: string;
  wallets?: VendorWallet[];
};

export type FiatDeposit = {
  id: string;
  status: string;
  walletId: string | null;
  asset: string;
  amountCents: number | null;
  actualAmountCents: number | null;
  anchorId: string;
  anchorTransactionId: string;
  txHash: string | null;
  stellarExpertUrl: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type FiatWithdrawal = {
  id: string;
  status: string;
  asset: string;
  targetFiat: string | null;
  amountCents: number | null;
  actualAmountCents: number | null;
  anchorId: string;
  anchorTransactionId: string;
  txHash: string | null;
  stellarExpertUrl: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type AuditEvent = {
  id: string;
  eventType: string;
  actor: string;
  spendRequestId: string | null;
  payload: Record<string, unknown>;
  sorobanTxHash: string | null;
  createdAt: string;
};

export type TreasuryBalances = {
  treasuryPublicKey: string;
  network: string;
  balances: { assetCode: string; amount: string; amountCents: number | null }[];
};

export type Listed<T> = { data: T[]; total?: number };
