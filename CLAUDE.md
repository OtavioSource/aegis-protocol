# CommandRail

## Definition

CommandRail is a governance layer for AI agents that need controlled economic autonomy using programmable treasury and payments on Solana.

---

## Purpose

This file guides Claude Code during the implementation of CommandRail.

The project must be built as a **credible hackathon MVP with real startup potential**, not as a toy demo.

Priority order:

1. clear product narrative
2. strong governance flow
3. meaningful Solana relevance
4. fast MVP execution
5. extensibility after the hackathon

---

## Product Scope

CommandRail is **not** an agent framework.
CommandRail is a **control plane and governance API** for any agent capable of calling an HTTP API.

The system must:

- receive economic action requests from agents
- evaluate them against company policies
- approve, reject, or require human approval
- orchestrate treasury/payment execution via Solana
- log all decisions for auditability

---

## Core Loop

```
Agent requests spend → Policy evaluates → System decides → Action is audited → Treasury execution is controlled
```

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Monorepo | Turborepo + pnpm |
| Backend | Fastify + TypeScript + Zod |
| ORM | Prisma |
| Database | PostgreSQL |
| Frontend | Next.js 14+ App Router + Tailwind + shadcn/ui |
| Auth (agents) | API keys (Bearer token) |
| Auth (dashboard) | NextAuth credentials |
| API style | REST + Zod validation |
| Solana | @solana/web3.js + SPL tokens (devnet) |
| Deploy | Vercel (web) + Railway (API) + Neon (DB) |

---

## Monorepo Structure

```
command-rail/
├── apps/
│   ├── web/          # Next.js dashboard (admin + approvals)
│   └── api/          # Fastify API server
├── packages/
│   ├── shared/       # Zod schemas, types, constants
│   ├── policy-engine/ # Pure policy evaluation logic (no I/O)
│   ├── solana/       # Treasury adapters, SPL transfers
│   └── sdk/          # TypeScript SDK for agents
├── prisma/
│   └── schema.prisma
├── docker-compose.yml
└── turbo.json
```

---

## Domain Model (8 entities)

1. **Company** — org/tenant (id, name, slug)
2. **Treasury** — Solana wallet + config (id, companyId, name, network, baseCurrency, walletAddress, status)
3. **Agent** — registered agent (id, companyId, name, externalAgentId, type, status, killSwitchActive, apiKeyHash, treasuryId)
4. **Policy** — rules attached to agent (id, agentId, name, rulesJson: maxTransaction, dailyLimit, monthlyLimit, vendorAllowList, vendorDenyList, approvalThreshold, allowedActionTypes)
5. **Budget** — spending limits (id, agentId, dailyLimit, monthlyLimit, perTransactionLimit, currency, active)
6. **SpendRequest** — economic request (id, companyId, agentId, actionType, vendor, amount, currency, reason, reference, status, policyDecision, txSignature, metadataJson)
7. **ApprovalRequest** — human approval (id, spendRequestId, approverEmail, status, decisionReason, decidedAt)
8. **AuditLog** — immutable event log (id, companyId, agentId, spendRequestId, eventType, actorType, actorId, payloadJson)

---

## Policy Engine

Lives in `packages/policy-engine`. Must be pure, deterministic, testable, zero I/O.

### Supported rules:
- maxTransactionAmount — reject if amount exceeds limit
- dailyBudget — reject if cumulative daily spend exceeds limit
- monthlyBudget — reject if cumulative monthly spend exceeds limit
- vendorAllowList — reject if vendor not in list
- vendorDenyList — reject if vendor in list
- requireApprovalAbove — require human approval above threshold
- allowedActionTypes — reject if action type not allowed
- killSwitch — reject everything if active

### Decision outputs:
- `APPROVED`
- `REQUIRES_APPROVAL`
- `REJECTED`

Each decision includes: matched rule, reason, policy snapshot.

---

## API Surface

### Agents
- `POST /companies/:companyId/agents` — register agent, returns API key
- `GET /companies/:companyId/agents` — list agents
- `GET /agents/:agentId` — agent details
- `PATCH /agents/:agentId` — update agent
- `POST /agents/:agentId/kill-switch` — toggle kill switch

### Spend Requests
- `POST /spend-requests` — agent submits request (evaluated automatically)
- `GET /spend-requests/:requestId` — check status
- `POST /spend-requests/:requestId/execute` — execute approved request

### Approvals
- `GET /approvals/pending` — pending approvals
- `POST /approvals/:approvalId/approve` — approve
- `POST /approvals/:approvalId/reject` — reject

### Audit
- `GET /companies/:companyId/audit-logs` — query audit trail

### Setup
- `POST /companies` — create company
- `POST /companies/:companyId/treasuries` — create treasury
- `POST /companies/:companyId/budgets` — create budget
- `POST /agents/:agentId/policies` — assign policy

---

## Solana Integration

Solana is structural, not cosmetic.

### What to implement (devnet):
- Treasury wallets as real Solana keypairs
- USDC devnet token accounts per treasury
- Approved spend → real SPL token transfer on devnet
- Transaction signatures stored in audit log, linkable to Solana Explorer
- Kill switch → revoke delegate authority (freeze treasury)

### What NOT to implement:
- Custom on-chain programs (Anchor) — use standard SPL
- Mainnet anything — devnet is sufficient
- Complex multi-sig — server holds delegate authority

All Solana logic must live in `packages/solana` behind adapter interfaces.

---

## Primary Demo Scenario

**API procurement agent** — marketing bot purchasing API access.

Scenarios to demo:
1. Small spend (< 10 USDC) → auto-approved → Solana transfer
2. Medium spend (10-50 USDC) → requires human approval → admin approves → transfer
3. Blocked vendor → rejected
4. Kill switch activated → all requests rejected, treasury frozen

---

## Non-Goals

Do not build:
- a full agent runtime
- generic chat UX
- LLM orchestration tooling
- a procurement ERP
- multi-chain support
- custom on-chain programs
- unnecessary abstractions

---

## Product Framing

Always frame as:
- governance layer for AI agents
- economic control plane
- controlled autonomy
- programmable treasury on Solana

Never frame as:
- AI wallet app
- crypto dashboard
- chatbot with payments

---

## Engineering Standards

- strict TypeScript, no implicit any
- thin routes, business logic in services
- policy logic separate from persistence
- Solana logic isolated behind adapters
- prefer explicit domain models
- keep modules small and testable

---

## Hackathon Context

- **Event:** Solana Frontier Hackathon (Colosseum)
- **Deadline:** May 11, 2026
- **Submission:** GitHub repo + pitch video (3min) + technical demo (2-3min) + form
- **Judging:** Market fit, traction, technical implementation, Solana integration, MVP quality
