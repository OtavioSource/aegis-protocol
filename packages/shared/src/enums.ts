/**
 * @file enums.ts
 * @package @aegis/shared
 *
 * ═══════════════════════════════════════════════════════════════
 *  SHARED ENUMS — STATUS CODES AND EVENT TYPES
 * ═══════════════════════════════════════════════════════════════
 *
 * All enums used across the Aegis Protocol system are defined here and
 * re-exported from the @aegis/shared package.
 *
 * Using string enums (ENUM_VALUE = 'ENUM_VALUE') rather than numeric enums
 * because these values are stored as strings in the PostgreSQL DB and appear
 * in API responses — having them match their string value makes debugging
 * and DB inspection much easier than opaque numbers like 0, 1, 2.
 *
 * These enums also appear in Prisma schema as DB-level enum types,
 * ensuring the DB rejects invalid values at the constraint layer.
 */

/**
 * AgentStatus — the operational state of an AI agent.
 *
 * ACTIVE:   Normal operation. Spend requests are evaluated against policy.
 * DISABLED: Permanent soft-disable. Agent exists in the system (history preserved)
 *           but cannot submit new requests. Set via admin action, not kill switch.
 *           Unlike kill switch, DISABLED is not an emergency — it's administrative.
 */
export enum AgentStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

/**
 * TreasuryStatus — the operational state of a treasury wallet.
 *
 * ACTIVE: Normal operation. Transfers can be executed via /spend-requests/:id/execute.
 * FROZEN: Kill switch engaged. No transfers allowed regardless of spend request status.
 *         Set when POST /agents/:id/kill-switch { active: true } is called.
 *         In production, would be enforced on-chain via revoking transfer authority.
 */
export enum TreasuryStatus {
  ACTIVE = 'ACTIVE',
  FROZEN = 'FROZEN',
}

/**
 * SpendRequestStatus — tracks the full lifecycle of a spend request.
 *
 * State machine:
 *
 *   PENDING ──────────────────────────────────────────────────┐
 *       │ (policy engine evaluates)                           │
 *       ├──→ APPROVED (auto-approved, ready to execute)       │
 *       │        └──→ EXECUTED (Solana transfer confirmed)    │
 *       │        └──→ FAILED (Solana execution error)         │
 *       ├──→ REQUIRES_APPROVAL (human review needed)          │
 *       │        └──→ APPROVED (human approved → then execute)│
 *       │        └──→ REJECTED (human rejected)               │
 *       └──→ REJECTED (policy blocked it)                     │
 *                                                             │
 * Note: PENDING is the initial state, immediately resolved to ┘
 * one of the three policy outcomes. The system rarely stays in PENDING
 * for more than milliseconds (the evaluation is synchronous).
 */
export enum SpendRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REQUIRES_APPROVAL = 'REQUIRES_APPROVAL',
  REJECTED = 'REJECTED',
  EXECUTED = 'EXECUTED',
  FAILED = 'FAILED',
}

/**
 * PolicyDecision — the three possible outcomes from the policy engine.
 *
 * This is the direct output of evaluate() in @aegis/policy-engine.
 * Stored on SpendRequest.policyDecision alongside the operational status.
 *
 * Why separate from SpendRequestStatus?
 *   policyDecision captures what the POLICY ENGINE decided (immutable after creation).
 *   status tracks the OPERATIONAL STATE (changes as the request flows through the system).
 *   Example: a REQUIRES_APPROVAL request can become APPROVED (after human approval)
 *   or REJECTED (if human denies) — but its policyDecision stays REQUIRES_APPROVAL forever.
 */
export enum PolicyDecision {
  APPROVED = 'APPROVED',
  REQUIRES_APPROVAL = 'REQUIRES_APPROVAL',
  REJECTED = 'REJECTED',
}

/**
 * ApprovalStatus — state of a human review record.
 *
 * PENDING:  Waiting for an admin to act in the dashboard.
 * APPROVED: Admin approved — spend request moves to APPROVED, ready for /execute.
 * REJECTED: Admin rejected — spend request moves to REJECTED, no Solana transfer.
 */
export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * AuditEventType — every type of event that gets recorded in the audit log.
 *
 * Grouped by domain:
 *
 *   Agent lifecycle:
 *     AGENT_REGISTERED        — new agent created
 *     AGENT_DISABLED          — agent soft-disabled
 *     AGENT_ENABLED           — agent re-enabled
 *     KILL_SWITCH_ACTIVATED   — emergency stop triggered
 *     KILL_SWITCH_DEACTIVATED — emergency stop lifted
 *
 *   Spend request lifecycle:
 *     SPEND_REQUEST_SUBMITTED        — agent submitted a request
 *     SPEND_REQUEST_APPROVED         — policy engine auto-approved
 *     SPEND_REQUEST_REJECTED         — policy engine rejected
 *     SPEND_REQUEST_REQUIRES_APPROVAL — escalated to human review
 *     SPEND_REQUEST_EXECUTED         — Solana transfer confirmed on-chain
 *     SPEND_REQUEST_FAILED           — Solana execution failed
 *
 *   Human approval:
 *     APPROVAL_REQUESTED — (reserved for future webhook notifications)
 *     APPROVAL_GRANTED   — admin approved in dashboard
 *     APPROVAL_DENIED    — admin rejected in dashboard
 *
 *   Admin/setup operations:
 *     POLICY_ASSIGNED   — new policy rules assigned to agent
 *     BUDGET_CREATED    — spending limits set or updated
 *     TREASURY_CREATED  — new Solana wallet created
 *     TREASURY_FUNDED   — demo tokens minted to treasury (devnet)
 *     TREASURY_FROZEN   — treasury frozen (kill switch on-chain enforcement)
 */
export enum AuditEventType {
  AGENT_REGISTERED = 'AGENT_REGISTERED',
  AGENT_DISABLED = 'AGENT_DISABLED',
  AGENT_ENABLED = 'AGENT_ENABLED',
  KILL_SWITCH_ACTIVATED = 'KILL_SWITCH_ACTIVATED',
  KILL_SWITCH_DEACTIVATED = 'KILL_SWITCH_DEACTIVATED',
  SPEND_REQUEST_SUBMITTED = 'SPEND_REQUEST_SUBMITTED',
  SPEND_REQUEST_APPROVED = 'SPEND_REQUEST_APPROVED',
  SPEND_REQUEST_REJECTED = 'SPEND_REQUEST_REJECTED',
  SPEND_REQUEST_REQUIRES_APPROVAL = 'SPEND_REQUEST_REQUIRES_APPROVAL',
  SPEND_REQUEST_EXECUTED = 'SPEND_REQUEST_EXECUTED',
  SPEND_REQUEST_FAILED = 'SPEND_REQUEST_FAILED',
  APPROVAL_REQUESTED = 'APPROVAL_REQUESTED',
  APPROVAL_GRANTED = 'APPROVAL_GRANTED',
  APPROVAL_DENIED = 'APPROVAL_DENIED',
  POLICY_ASSIGNED = 'POLICY_ASSIGNED',
  BUDGET_CREATED = 'BUDGET_CREATED',
  TREASURY_CREATED = 'TREASURY_CREATED',
  TREASURY_FUNDED = 'TREASURY_FUNDED',
  TREASURY_FROZEN = 'TREASURY_FROZEN',
}

/**
 * ActorType — who or what triggered an audit event.
 *
 * AGENT:    An AI agent (identified by agent ID) submitted a request.
 * ADMIN:    A human admin acted in the dashboard (approved, rejected, kill switch, etc.).
 * SYSTEM:   The system itself made a decision (policy engine evaluation, treasury execution).
 * APPROVER: A human from the approval queue acted on a spend request.
 *
 * In practice, actorType = SYSTEM with actorId = 'policy-engine' or 'treasury' covers
 * most automated decisions. This distinction matters for compliance reports:
 * "Was this decision made by a human or by the system?"
 */
export enum ActorType {
  AGENT = 'AGENT',
  ADMIN = 'ADMIN',
  SYSTEM = 'SYSTEM',
  APPROVER = 'APPROVER',
}

/**
 * SolanaNetwork — which Solana network the treasury operates on.
 *
 * DEVNET:  Public Solana test network. Free airdrops, no real value.
 *          Aegis Protocol MVP uses devnet exclusively.
 * MAINNET: Production network. Real SOL and USDC. Used post-hackathon.
 */
export enum SolanaNetwork {
  DEVNET = 'devnet',
  MAINNET = 'mainnet-beta',
}

/**
 * Currency — supported payment currencies.
 *
 * USDC: USD Coin — the primary currency for Aegis Protocol payments.
 *       Chosen for stability (pegged to $1) and wide SPL token support.
 *       On devnet: custom demo mint. On mainnet: Circle's USDC.
 * SOL:  Native Solana token. Supported for future SOL-denominated budgets.
 *       Currently used only for gas fees, not as a payment currency.
 */
export enum Currency {
  USDC = 'USDC',
  SOL = 'SOL',
}
