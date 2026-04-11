/**
 * @file types.ts
 * @package @command-rail/shared
 *
 * ═══════════════════════════════════════════════════════════════
 *  SHARED DOMAIN TYPES — THE CONTRACT BETWEEN ALL PACKAGES
 * ═══════════════════════════════════════════════════════════════
 *
 * This file defines the TypeScript types that flow through every layer
 * of CommandRail: from the REST API → policy engine → Solana adapter → dashboard.
 *
 * Why a shared package?
 *   Without a shared contract, each package would define its own version of
 *   "what is an Agent?" and "what does a PolicyEvaluationResult look like?".
 *   This package ensures all packages speak the same language.
 *
 *   The types here are imported by:
 *   - @command-rail/policy-engine: uses PolicyEvaluationInput, PolicyEvaluationResult
 *   - @command-rail/solana: uses TreasuryStatus, SolanaNetwork, Currency
 *   - apps/api: uses all domain types for route handlers and DB mapping
 *   - apps/web: uses all types for dashboard rendering
 *   - @command-rail/sdk: uses SpendRequest, PolicyDecision for agent SDK
 *
 * Domain model overview (8 entities):
 *
 *   Company ─┬─── Treasury (Solana wallet, SPL token payments)
 *            └─── Agent ──┬─── Policy (governance rules as JSON)
 *                         ├─── Budget (spending limits)
 *                         └─── SpendRequest ──┬─── ApprovalRequest (human review)
 *                                             └─── AuditLog (immutable events)
 *
 * PolicyEvaluationInput / PolicyEvaluationResult:
 *   These two types define the interface between the API layer and the
 *   policy engine. The API constructs an input from DB data (agent status,
 *   budget aggregates, active policy rules) and passes it to evaluate().
 *   The policy engine returns a result — the API never calls the DB inside evaluate().
 */

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

// ─── Domain Types ─────────────────────────────────────────────────────────────

/**
 * Company — the top-level organizational unit (tenant).
 * All other entities belong to a company. Multi-tenant isolation is enforced
 * via companyId on every query in the API routes.
 */
export type Company = {
  id: string;
  name: string;
  /** URL-safe identifier, globally unique — used in human-readable contexts */
  slug: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Treasury — a Solana wallet that executes payments on behalf of agents.
 *
 * The walletAddress is public (safe to share).
 * The secret key (encryptedSecret in DB) is NEVER included in this type —
 * it's stripped before any API response and stays server-side only.
 *
 * One company can have multiple treasuries (e.g., one per team or use case).
 * Each agent links to exactly one treasury via Agent.treasuryId.
 */
export type Treasury = {
  id: string;
  companyId: string;
  name: string;
  network: SolanaNetwork;
  baseCurrency: Currency;
  /** Solana public key (base58) — the on-chain wallet address */
  walletAddress: string;
  /** ACTIVE: operational | FROZEN: kill switch engaged, no transfers */
  status: TreasuryStatus;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Agent — a registered AI agent with controlled economic autonomy.
 *
 * Each agent has:
 *   - An API key (stored as hash, used to authenticate spend requests)
 *   - A status (ACTIVE = normal | DISABLED = permanently blocked)
 *   - A killSwitchActive flag (emergency stop, toggleable, highest priority in policy engine)
 *   - An optional link to a treasury (where its payments come from)
 *   - An optional owner (the human responsible for this agent)
 */
export type Agent = {
  id: string;
  companyId: string;
  treasuryId: string | null;
  name: string;
  /** Optional: ID from the external agent framework (LangChain, CrewAI, etc.) */
  externalAgentId: string | null;
  /** Free-form tag: "marketing-bot", "infra-agent", "procurement-agent", etc. */
  type: string;
  status: AgentStatus;
  /** When true, ALL spend requests are blocked (Rule 1 in policy engine) */
  killSwitchActive: boolean;
  ownerName: string | null;
  ownerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * PolicyRules — the governance ruleset stored as JSON in the Policy model.
 *
 * These are the knobs operators turn to govern what an agent can spend.
 * All fields are optional — unset fields mean "no restriction for this rule".
 *
 * Evaluated in priority order by the policy engine (see evaluate.ts):
 *   maxTransactionAmount → hard ceiling per transaction (finer than budget limit)
 *   requireApprovalAbove → escalation threshold (human reviews above this)
 *   vendorAllowList      → whitelist mode (empty = all vendors allowed)
 *   vendorDenyList       → blacklist mode (always checked, regardless of allowlist)
 *   allowedActionTypes   → restrict which action categories the agent can perform
 *
 * Budget limits (dailyBudget, monthlyBudget) are on the Budget entity — these
 * are kept separate because budgets change more frequently than policy rules.
 */
export type PolicyRules = {
  /** Maximum allowed per-transaction amount in the budget's currency */
  maxTransactionAmount?: number;
  /** (Deprecated — use Budget entity) Daily aggregate spend limit */
  dailyBudget?: number;
  /** (Deprecated — use Budget entity) Monthly aggregate spend limit */
  monthlyBudget?: number;
  /** If set, only these vendors can receive payments (case-insensitive) */
  vendorAllowList?: string[];
  /** If set, these vendors are always blocked regardless of allowlist (case-insensitive) */
  vendorDenyList?: string[];
  /** Requests above this amount require human approval before execution */
  requireApprovalAbove?: number;
  /** If set, only these action type strings are permitted */
  allowedActionTypes?: string[];
};

/**
 * Policy — a named set of governance rules assigned to an agent.
 *
 * At most one policy per agent is active at a time. When a new policy is
 * assigned, the previous one is deactivated (but preserved for audit history).
 * The rules field is PolicyRules stored as JSON in the DB.
 */
export type Policy = {
  id: string;
  agentId: string;
  name: string;
  rules: PolicyRules;
  /** Only one policy per agent can be active — enforced by POST /agents/:id/policies */
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Budget — per-agent spending limits enforced by the policy engine.
 *
 * Separate from Policy because budgets change more frequently (monthly reviews,
 * business approvals) than policy rules (governance decisions, security controls).
 *
 * All three limits are checked independently — an agent can be under its daily
 * limit but over its monthly limit and still be blocked.
 *
 * Stored as Decimal(18,6) in the DB to handle sub-cent USDC precision.
 */
export type Budget = {
  id: string;
  agentId: string;
  /** Hard ceiling per individual transaction */
  dailyLimit: number;
  /** Rolling 24-hour aggregate spend ceiling */
  monthlyLimit: number;
  /** Rolling 30-day aggregate spend ceiling */
  perTransactionLimit: number;
  currency: Currency;
  active: boolean;
  createdAt: Date;
};

/**
 * SpendRequest — the central entity of CommandRail.
 *
 * Created when an AI agent calls POST /spend-requests.
 * Lifecycle: PENDING → APPROVED | REJECTED | REQUIRES_APPROVAL → EXECUTED | FAILED
 *
 * Key fields:
 *   - policyDecision: the raw output from the policy engine (APPROVED/REJECTED/REQUIRES_APPROVAL)
 *   - status: operational status (tracks execution state after the policy decision)
 *   - txSignature: Solana transaction signature (populated after /execute)
 *   - matchedRule: which policy rule triggered the decision (for audit log context)
 */
export type SpendRequest = {
  id: string;
  companyId: string;
  agentId: string;
  /** Category of economic action: "purchase_api_access", "buy_compute", "enrich_leads", etc. */
  actionType: string;
  /** Name of the vendor receiving payment (checked against allow/deny lists) */
  vendor: string;
  amount: number;
  currency: Currency;
  /** Human-readable explanation from the agent for why it needs this spend */
  reason: string;
  reference: string | null;
  status: SpendRequestStatus;
  /** Direct output from the policy engine evaluate() call */
  policyDecision: PolicyDecision | null;
  /** Human-readable explanation of why the decision was made */
  decisionReason: string | null;
  /** Solana transaction signature — set after successful /execute call */
  txSignature: string | null;
  /** Arbitrary metadata from the agent (model used, context, trace IDs, etc.) */
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * ApprovalRequest — human review record for REQUIRES_APPROVAL spend requests.
 *
 * Created automatically when the policy engine returns REQUIRES_APPROVAL.
 * Appears in GET /approvals/pending for the dashboard approval queue.
 * One ApprovalRequest per SpendRequest (enforced by @unique in DB schema).
 */
export type ApprovalRequest = {
  id: string;
  spendRequestId: string;
  approverEmail: string;
  status: ApprovalStatus;
  decisionReason: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

/**
 * AuditLog — an immutable record of every governance event.
 *
 * Never updated or deleted. Every state change in the system produces
 * at least one audit log entry. The payload field stores event-specific
 * context (matched rule, tx signature, decision reason, etc.).
 *
 * Indexed on (companyId, createdAt) and (agentId, createdAt) for
 * fast time-range queries in the dashboard audit log view.
 */
export type AuditLog = {
  id: string;
  companyId: string;
  agentId: string | null;
  spendRequestId: string | null;
  eventType: AuditEventType;
  actorType: ActorType;
  /** Who triggered this event: agent ID, 'admin', 'policy-engine', 'treasury' */
  actorId: string;
  /** Event-specific context: matched rule, tx signature, previous state, etc. */
  payload: Record<string, unknown>;
  createdAt: Date;
};

// ─── Policy Engine Types ───────────────────────────────────────────────────────

/**
 * PolicyEvaluationInput — everything the policy engine needs to make a decision.
 *
 * Constructed by the API layer from live DB data before calling evaluate().
 * Critically, the policy engine NEVER touches the database — it receives
 * pre-computed budget aggregates (dailySpent, monthlySpent) from the API.
 *
 * This separation is what makes the policy engine:
 *   - A pure function (no I/O inside evaluate())
 *   - Deterministic (same input always → same output)
 *   - Testable without any DB mocking
 */
export type PolicyEvaluationInput = {
  spendRequest: {
    /** Amount requested in the budget's currency (e.g., 15.5 for $15.50 USDC) */
    amount: number;
    /** Vendor name — checked against allow/deny lists (case-insensitive) */
    vendor: string;
    /** Action category — checked against allowedActionTypes */
    actionType: string;
    currency: Currency;
  };
  agent: {
    status: AgentStatus;
    /** When true, all requests are blocked regardless of other rules */
    killSwitchActive: boolean;
  };
  /** Active policy rules for this agent (empty object = no restrictions) */
  policy: PolicyRules;
  budget: {
    /** Hard ceiling per transaction (0 = no limit) */
    perTransactionLimit: number;
    /** Rolling 24h aggregate limit (0 = no limit) */
    dailyLimit: number;
    /** Rolling 30d aggregate limit (0 = no limit) */
    monthlyLimit: number;
    /** Sum of EXECUTED requests today (pre-computed by API before calling evaluate) */
    dailySpent: number;
    /** Sum of EXECUTED requests this month (pre-computed by API) */
    monthlySpent: number;
  };
};

/**
 * PolicyEvaluationResult — the decision returned by the policy engine.
 *
 * The decision field drives downstream behavior in the API:
 *   APPROVED         → SpendRequest.status = 'APPROVED', ready for /execute
 *   REQUIRES_APPROVAL → ApprovalRequest created, waiting for human review
 *   REJECTED          → SpendRequest.status = 'REJECTED', no Solana transfer
 *
 * matchedRule identifies which of the 9 rules triggered the decision.
 * policySnapshot captures the exact policy state at decision time for audit.
 */
export type PolicyEvaluationResult = {
  decision: PolicyDecision;
  /** Human-readable explanation of why this decision was made */
  reason: string;
  /** Which rule matched: 'kill_switch', 'vendor_denied', 'require_approval_above', 'none', etc. */
  matchedRule: string;
  /** Snapshot of the policy rules active at decision time (for immutable audit records) */
  policySnapshot: PolicyRules;
};
