# Aegis Protocol

**Economic governance layer for AI agents with programmable, Solana-native treasury.**

> "Stripe for AI agent payments" — but with policy controls, kill switches, and on-chain auditability.

---

## The Problem

Companies want to give AI agents economic autonomy (pay for APIs, buy datasets, renew credits) — but without governance, they're forced to choose between **blocking everything** (losing automation) or **allowing everything** (losing control).

## The Solution

Aegis Protocol is an **economic control plane**. Agents submit spend requests. Policies evaluate them. Aegis Protocol approves, rejects, or escalates for human review. Solana executes. Everything is audited on-chain.

```
Agent requests spend → Policy evaluates → System decides → cNFT receipt minted → Treasury executes
```

---

## Why Solana

Aegis is built on four Solana-native primitives that no other chain can replicate as a package:

| Feature | What it does | Why Solana |
|---------|-------------|------------|
| **Token-2022 + Permanent Delegate** | Kill switch sweeps tokens on-chain — cryptographically enforced, not just a DB flag | Token-2022 extension, no equivalent on EVM chains |
| **cNFT Audit Receipts** | Every policy decision mints a compressed NFT — tamper-proof on-chain audit trail at $0.00005/receipt | Metaplex Bubblegum + concurrent Merkle trees |
| **Solana Pay** | Vendors generate QR invoices; agents call `aegis.pay(uri)` — governed, on-chain, instant | Solana Pay spec (SIMD-0057), native to Solana wallet ecosystem |
| **SPL Token Transfers** | Real USDC transfers on devnet, not simulations | SPL + Token-2022 as payment rails |

These four features together form a governance stack that doesn't exist on any other chain.

---

## Demo Scenarios

Run `pnpm --filter @aegis/api demo` to see all scenarios:

| Scenario | Amount | Result | On-chain proof |
|----------|--------|--------|---------------|
| API subscription | 7 USDC | Auto-approved → SPL transfer | Explorer tx link |
| Lead dataset | 30 USDC | Requires human approval → admin approves → transfer | Explorer tx link |
| Blocked vendor | 5 USDC | Rejected — `vendor_not_allowed` | cNFT receipt (REJECTED) |
| Kill switch | any | All blocked — `kill_switch`; Permanent Delegate sweeps treasury on-chain | Delegate sweep tx visible on Explorer |
| Solana Pay invoice | any | Vendor QR → `aegis.pay(uri)` → policy → transfer | Explorer tx + cNFT receipt |

---

## Architecture

```
aegis-protocol/
├── apps/
│   ├── api/            # Fastify REST API — governance + treasury orchestration
│   └── web/            # Next.js dashboard — approvals, agents, audit log
├── packages/
│   ├── shared/         # Zod schemas, enums, domain types, SettlementAdapter interface
│   ├── policy-engine/  # Pure policy evaluation — zero I/O, 17 unit tests
│   ├── solana/         # Token-2022 treasury, cNFT receipts, Solana Pay URI
│   └── sdk/            # TypeScript SDK for AI agents (includes pay() method)
└── prisma/
    └── schema.prisma   # 8-entity domain model
```

### Solana Integration (Solana-native, not cosmetic)

**Token-2022 + Permanent Delegate (kill switch)**
- Demo mint is a Token-2022 mint with the `PermanentDelegate` extension
- Aegis holds the Permanent Delegate authority (`AEGIS_DELEGATE_SECRET`)
- When kill switch is activated, `freezeTreasury()` executes an on-chain `transferChecked` sweeping the entire frozen treasury balance to a quarantine wallet — **no one can spend those tokens**, even if the DB is compromised
- Visible on Solana Explorer: the delegate keypair, not the treasury owner, signs the sweep

**cNFT Audit Receipts (Metaplex Bubblegum)**
- Every policy decision (APPROVED / REJECTED / REQUIRES_APPROVAL) mints a compressed NFT
- One Merkle tree per company (`maxDepth=14` = 16,384 receipts), created lazily on first spend request
- Cost: ~$0.00005/receipt (vs ~$0.20 for standard NFTs) — viable at 10,000 decisions/day
- Each cNFT encodes: `spendRequestId`, `decision`, `agentId`, `vendor`, `amount`, `timestamp`
- Receipt asset ID stored in audit log; dashboard links directly to Solana Explorer

**Solana Pay (vendor invoicing)**
- `GET /vendors/:id/solana-pay-uri?amount=X` generates a `solana:<recipient>?amount=...&spl-token=...&reference=...` URI per the Solana Pay spec (SIMD-0057)
- A fresh reference keypair per invoice enables on-chain payment tracking
- Agents call `aegis.pay(uri)` in the SDK — same governance flow, same cNFT receipt
- Dashboard can render the URI as a QR code for vendor invoicing

**SettlementAdapter (multi-chain architecture)**
- `SettlementAdapter` interface in `@aegis/shared` abstracts `createWallet()`, `transfer()`, `freeze()`, `getBalance()`
- `TreasuryService` (Solana) implements the interface
- Adding a Stellar adapter requires implementing the same interface — no changes to governance logic

---

## Domain Model

| Entity | Purpose |
|--------|---------|
| Company | Tenant / organization (has a Merkle tree for cNFT receipts) |
| Treasury | Solana wallet + Token-2022 config |
| Agent | Registered AI agent with API key + kill switch |
| Policy | Governance rules attached to an agent |
| Budget | Spending limits (daily/monthly/per-tx) |
| SpendRequest | Economic request + policy decision + tx signature + cNFT receipt |
| ApprovalRequest | Human review record |
| AuditLog | Immutable event log (includes cNFT asset IDs) |

### Policy Rules (10 rules, evaluated in priority order)

1. `kill_switch` — blocks all requests if active (backed by on-chain Permanent Delegate sweep)
2. `agent_disabled` — blocks disabled agents
3. `action_type_not_allowed` — restricts action categories
4. `vendor_denied` — explicit deny list
5. `vendor_not_allowed` — allow list enforcement
6. `per_transaction_limit_exceeded` — per-request ceiling
7. `max_transaction_amount_exceeded` — policy hard max
8. `daily_budget_exceeded` — rolling 24h limit
9. `monthly_budget_exceeded` — rolling 30d limit
10. `require_approval_above` — escalate to human above threshold

---

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 10+
- Docker Desktop

### Setup

```bash
# 1. Clone and install
git clone https://github.com/OtavioSource/aegis-protocol
cd aegis-protocol
pnpm install

# 2. Start database
docker compose up -d

# 3. Run migrations and seed demo data
pnpm --filter @aegis/api db:migrate
pnpm --filter @aegis/api db:seed

# 4. Configure environment
cp apps/api/.env.example apps/api/.env
# Fill in values from seed output + generate AEGIS_DELEGATE_SECRET (see below)

# 5. Fund treasury with Token-2022 test tokens
curl -X POST http://localhost:3001/companies/$COMPANY_ID/treasuries/$TREASURY_ID/fund-demo \
  -H "Content-Type: application/json" -d '{"amount": 10000}'
# Save mintAddress as DEVNET_DEMO_MINT_ADDRESS in .env
# Save permanentDelegateAddress, generate AEGIS_DELEGATE_SECRET keypair

# 6. Start dev servers
pnpm dev

# 7. Run the animated demo
pnpm --filter @aegis/api demo
```

**Dashboard:** http://localhost:3000
**API:** http://localhost:3001

### Generate Delegate Keypair

```bash
node -e "
const { Keypair } = require('@solana/web3.js');
const kp = Keypair.generate();
console.log('Public key:', kp.publicKey.toBase58());
console.log('AEGIS_DELEGATE_SECRET=' + Buffer.from(kp.secretKey).toString('base64'));
"
```

Set `AEGIS_DELEGATE_SECRET` in `apps/api/.env`. Fund the delegate wallet with devnet SOL via faucet.

---

## API Reference

### Spend Requests (agents)

```bash
# Submit a spend request — policy evaluated immediately
POST /spend-requests
Authorization: Bearer cr_...
{ "actionType": "purchase_api_access", "vendor": "OpenAI",
  "amount": 7, "currency": "USDC", "reason": "Monthly API subscription" }

# Execute an approved request (triggers Token-2022 transfer + cNFT receipt)
POST /spend-requests/:id/execute

# Check status (includes txSignature, explorerUrl, cNFT asset ID)
GET /spend-requests/:id
```

### Vendor Invoicing (Solana Pay)

```bash
# Generate a Solana Pay URI for a vendor invoice
GET /vendors/:vendorId/solana-pay-uri?amount=25&message=API+access
# Returns: { uri: "solana:<wallet>?amount=25&spl-token=...&reference=...", reference, explorerUrl }
```

### Agent Management (admin)

```bash
POST /companies/:id/agents            # Register agent, returns API key
POST /agents/:id/kill-switch          # { "active": true } — DB freeze + on-chain sweep
POST /agents/:id/policies             # Assign governance rules
POST /companies/:id/budgets           # Set spending limits
```

### Approvals (admin)

```bash
GET  /approvals/pending?companyId=...
POST /approvals/:id/approve           # { "decisionReason": "Verified vendor, proceed" }
POST /approvals/:id/reject
```

### Audit

```bash
GET /companies/:id/audit-logs
# Each entry includes eventType, actorType, payload (cNFT assetId, txSignature, etc.)
```

---

## SDK (for AI agents)

```typescript
import { Aegis } from '@aegis/sdk';

const aegis = new Aegis({
  apiKey: 'cr_your_api_key',
  baseUrl: 'https://api.aegis.io',
  agentId: 'agt_123',
});

// Submit a governed spend request
const request = await aegis.requestAndExecute({
  actionType: 'purchase_api_access',
  vendor: 'OpenAI',
  amount: 20,
  reason: 'GPT-4 API credits for Q2 campaign',
});
// { status: 'EXECUTED', txSignature: '...', explorerUrl: '...' }

// Pay a vendor via Solana Pay URI (from QR code or webhook)
const result = await aegis.pay('solana:So11...?amount=25&label=OpenAI&message=GPT-4+credits');
// Parses URI → governed SpendRequest → Token-2022 transfer → cNFT receipt

// Wait for human approval on escalated requests
if (request.status === 'REQUIRES_APPROVAL') {
  const approved = await aegis.waitForApproval(request.id);
  if (approved.status === 'APPROVED') {
    const executed = await aegis.execute(approved.id);
    console.log('TX:', executed.txSignature);
  }
}
```

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Monorepo | Turborepo + pnpm | Industry standard, minimal config |
| Backend | Fastify + TypeScript | Low boilerplate, fast, strict types |
| ORM | Prisma | Schema as documentation, type-safe queries |
| Database | PostgreSQL | Production-grade, concurrent writes |
| Frontend | Next.js 14+ App Router + Tailwind | Fast to build, professional |
| Solana | @solana/web3.js + @solana/spl-token | Token-2022, SPL transfers, Permanent Delegate |
| cNFT | Metaplex Bubblegum + UMI | Compressed NFT audit receipts |
| Policy | Pure TypeScript | Deterministic, testable, zero I/O |
| Multi-chain | SettlementAdapter interface | Swap Solana for Stellar without changing governance logic |

---

## Testing

```bash
# Policy engine unit tests (17 tests, zero I/O, deterministic)
pnpm --filter @aegis/policy-engine test

# TypeScript type checking across all packages
pnpm build

# Full E2E demo (requires running API + funded treasury)
pnpm --filter @aegis/api demo
```

---

## Monetization

- **Free:** 1 agent, basic policies, 100 tx/month
- **Pro ($49/mo):** 10 agents, advanced policies, unlimited tx, cNFT receipts
- **Enterprise ($499/mo):** Unlimited, custom policies, SLA, dedicated treasury, Permanent Delegate per tenant
- **Volume fee:** 0.1% of governed transaction volume (cap $1/tx)

---

## Hackathon

- **Event:** Solana Frontier Hackathon (Colosseum)
- **Deadline:** May 11, 2026
- **Category:** AI + Infrastructure
- **Repo:** https://github.com/OtavioSource/aegis-protocol
