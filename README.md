# Aegis Protocol

**Economic governance layer for AI agents with programmable treasury on Solana.**

> "Stripe for AI agent payments" — but with policy controls, kill switches, and on-chain auditability.

---

## The Problem

Companies want to give AI agents economic autonomy (pay for APIs, buy datasets, renew credits) — but without governance, they're forced to choose between **blocking everything** (losing automation) or **allowing everything** (losing control).

## The Solution

Aegis Protocol is an **economic control plane**. Agents submit spend requests. Policies evaluate them. Aegis Protocol approves, rejects, or escalates for human review. Solana executes. Everything is audited.

```
Agent requests spend → Policy evaluates → System decides → Action is audited → Treasury executes
```

---

## Demo

**Live scenarios** (run `pnpm demo` from `apps/api`):

| Scenario | Amount | Result |
|----------|--------|--------|
| API subscription | 7 USDC | Auto-approved → SPL transfer on Solana |
| Lead dataset | 30 USDC | Requires human approval → admin approves → transfer |
| Blocked vendor | 5 USDC | Rejected by policy — `vendor_not_allowed` |
| Kill switch | any | All requests blocked — `kill_switch` |

---

## Architecture

```
aegis-protocol/
├── apps/
│   ├── api/          # Fastify REST API — governance + treasury orchestration
│   └── web/          # Next.js 16 dashboard — approvals, agents, audit log
├── packages/
│   ├── shared/       # Zod schemas, enums, domain types
│   ├── policy-engine/ # Pure policy evaluation — zero I/O, 17 unit tests
│   ├── solana/       # Treasury adapters — SPL transfers, fund, freeze
│   └── sdk/          # TypeScript SDK for AI agents
└── prisma/
    └── schema.prisma # 8-entity domain model
```

### Domain Model

| Entity | Purpose |
|--------|---------|
| Company | Tenant / organization |
| Treasury | Solana wallet + config |
| Agent | Registered AI agent with API key |
| Policy | Rules attached to an agent |
| Budget | Spending limits (daily/monthly/per-tx) |
| SpendRequest | Economic request + policy decision + tx signature |
| ApprovalRequest | Human review record |
| AuditLog | Immutable event log |

### Policy Rules (evaluated in priority order)

1. `kill_switch` — blocks all requests if active
2. `agent_disabled` — blocks disabled agents
3. `action_type_not_allowed` — restricts action types
4. `vendor_denied` — explicit deny list
5. `vendor_not_allowed` — allow list enforcement
6. `per_transaction_limit_exceeded` — per-request ceiling
7. `max_transaction_amount_exceeded` — policy max
8. `daily_budget_exceeded` — rolling 24h limit
9. `monthly_budget_exceeded` — rolling 30d limit
10. `require_approval_above` — escalate above threshold

### Solana Integration

- Treasury wallets are real Solana keypairs stored in DB (base64-encoded)
- Approved spend requests trigger real **SPL token transfers** on devnet
- `txSignature` stored in audit log, linkable to Solana Explorer
- Kill switch freezes treasury (DB enforcement + optional on-chain)
- No custom programs — standard SPL only

---

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 10+
- Docker Desktop

### Setup

```bash
# 1. Clone and install
git clone https://github.com/aegis-protocol/aegis-protocol
cd aegis-protocol
pnpm install

# 2. Start database + Solana validator
docker compose up -d

# 3. Run migrations and seed demo data
pnpm --filter @aegis-protocol/api db:migrate
pnpm --filter @aegis-protocol/api db:seed

# 4. Configure environment — copy apps/api/.env.example to apps/api/.env
# Fill in DEMO_API_KEY and DEMO_COMPANY_ID from seed output

# 5. Fund treasury with test tokens
curl -X POST http://localhost:3001/companies/$COMPANY_ID/treasuries/$TREASURY_ID/fund-demo \
  -H "Content-Type: application/json" -d '{"amount": 10000}'

# 6. Start dev servers
pnpm dev

# 7. Run the animated demo
pnpm --filter @aegis-protocol/api demo
```

**Dashboard:** http://localhost:3000  
**API:** http://localhost:3001

---

## API Reference

### Spend Requests (agents)

```bash
# Submit a spend request
POST /spend-requests
Authorization: Bearer cr_...
{ "actionType": "purchase_api_access", "vendor": "DataVendorX",
  "amount": 7, "currency": "USDC", "reason": "Monthly API subscription" }

# Execute an approved request (triggers Solana transfer)
POST /spend-requests/:id/execute

# Check status
GET /spend-requests/:id
```

### Agent Management (admin)

```bash
POST /companies/:id/agents          # Register agent
POST /agents/:id/kill-switch        # { "active": true/false }
POST /agents/:id/policies           # Assign policy rules
POST /companies/:id/budgets         # Set budget limits
```

### Approvals (admin)

```bash
GET  /approvals/pending?companyId=...
POST /approvals/:id/approve         # { "decisionReason": "..." }
POST /approvals/:id/reject          # { "decisionReason": "..." }
```

### Audit

```bash
GET /companies/:id/audit-logs
```

---

## SDK (for AI agents)

```typescript
import { Aegis Protocol } from '@aegis-protocol/sdk';

const rail = new Aegis Protocol({
  apiKey: 'cr_your_api_key',
  baseUrl: 'https://api.aegis.io',
});

// Request a spend — policy evaluated automatically
const request = await rail.requestSpend({
  actionType: 'purchase_api_access',
  vendor: 'OpenAI',
  amount: 20,
  currency: 'USDC',
  reason: 'GPT-4 API credits for Q2 campaign',
});

// { id, status: 'APPROVED' | 'REQUIRES_APPROVAL' | 'REJECTED', ... }
```

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Monorepo | Turborepo + pnpm | Industry standard, minimal config |
| Backend | Fastify + TypeScript | Low boilerplate, fast |
| ORM | Prisma | Schema as documentation, DX |
| Database | PostgreSQL | Production-grade, concurrent writes |
| Frontend | Next.js 16 + Tailwind | Fast to build, professional |
| Solana | @solana/web3.js + SPL | Real devnet transfers, no custom programs |
| Policy | Pure TypeScript | Deterministic, testable, zero I/O |

---

## Testing

```bash
# Policy engine unit tests (17 tests)
pnpm --filter @aegis-protocol/policy-engine test

# Full E2E demo
pnpm --filter @aegis-protocol/api demo
```

---

## Monetization

- **Free:** 1 agent, basic policies, 100 tx/month
- **Pro ($49/mo):** 10 agents, advanced policies, unlimited tx
- **Enterprise ($499/mo):** Unlimited, custom policies, SLA, dedicated treasury
- **Alternative:** 0.1% of governed transaction volume (cap $1/tx)

---

## Hackathon

- **Event:** Solana Frontier Hackathon (Colosseum)
- **Deadline:** May 11, 2026
- **Category:** AI + Infrastructure / DeFi
