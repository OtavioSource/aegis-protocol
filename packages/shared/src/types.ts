import type {
  AgentStatus,
  ApprovalStatus,
  AuditEventType,
  ActorType,
  PolicyDecision,
  SpendRequestStatus,
  TreasuryStatus,
  SolanaNetwork,
  Currency,
} from './enums.js';

// ─── Domain Types ────────────────────────────────────────────────────────────

export type Company = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Treasury = {
  id: string;
  companyId: string;
  name: string;
  network: SolanaNetwork;
  baseCurrency: Currency;
  walletAddress: string;
  status: TreasuryStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type Agent = {
  id: string;
  companyId: string;
  treasuryId: string | null;
  name: string;
  externalAgentId: string | null;
  type: string;
  status: AgentStatus;
  killSwitchActive: boolean;
  ownerName: string | null;
  ownerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PolicyRules = {
  maxTransactionAmount?: number;
  dailyBudget?: number;
  monthlyBudget?: number;
  vendorAllowList?: string[];
  vendorDenyList?: string[];
  requireApprovalAbove?: number;
  allowedActionTypes?: string[];
};

export type Policy = {
  id: string;
  agentId: string;
  name: string;
  rules: PolicyRules;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type Budget = {
  id: string;
  agentId: string;
  dailyLimit: number;
  monthlyLimit: number;
  perTransactionLimit: number;
  currency: Currency;
  active: boolean;
  createdAt: Date;
};

export type SpendRequest = {
  id: string;
  companyId: string;
  agentId: string;
  actionType: string;
  vendor: string;
  amount: number;
  currency: Currency;
  reason: string;
  reference: string | null;
  status: SpendRequestStatus;
  policyDecision: PolicyDecision | null;
  decisionReason: string | null;
  txSignature: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type ApprovalRequest = {
  id: string;
  spendRequestId: string;
  approverEmail: string;
  status: ApprovalStatus;
  decisionReason: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

export type AuditLog = {
  id: string;
  companyId: string;
  agentId: string | null;
  spendRequestId: string | null;
  eventType: AuditEventType;
  actorType: ActorType;
  actorId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

// ─── Policy Engine Types ──────────────────────────────────────────────────────

export type PolicyEvaluationInput = {
  spendRequest: {
    amount: number;
    vendor: string;
    actionType: string;
    currency: Currency;
  };
  agent: {
    status: AgentStatus;
    killSwitchActive: boolean;
  };
  policy: PolicyRules;
  budget: {
    perTransactionLimit: number;
    dailyLimit: number;
    monthlyLimit: number;
    dailySpent: number;
    monthlySpent: number;
  };
};

export type PolicyEvaluationResult = {
  decision: PolicyDecision;
  reason: string;
  matchedRule: string;
  policySnapshot: PolicyRules;
};
