# Milestone 3 — Aegis Admin Dashboard: Tutorial & Walkthrough

> **Evidence: Tutorial Documentation** · Milestone 3 — Admin Dashboard & Operational Hardening
> Stack: Next.js 14 (App Router) + Tailwind + NextAuth · consumes the Aegis API (Fastify 5).
> Every API call is made **server-side** (`apps/web/lib/api.ts`); no secret ever reaches the browser.

## 1. What the dashboard is
The Aegis admin console is the human control plane for the non-custodial spend-governance
protocol. From it, an operator manages **policies, agents, wallets (non-custodial multisig),
vendors, spend requests, the human-approval queue, treasury balances, the fiat on/off-ramp, and
the immutable audit trail**.

## 2. Running it locally
Prerequisites: Node 22+, pnpm 10.5+, Postgres (local via `docker compose up -d`, or Neon).

```bash
pnpm install
pnpm --filter @aegis/api db:migrate      # schema
pnpm --filter @aegis/api db:seed:demo     # demo company + user + sample data
pnpm dev                                  # API on :4000, dashboard on :3000
```

Open **http://localhost:3000**, and log in with the demo credentials created by the demo seed
(`db:seed:demo`). Auth is handled by NextAuth (credentials provider → `POST /v1/auth/login`); the
API session token lives only in the httpOnly cookie and is **never** exposed to the browser
(`apps/web/lib/auth.ts`, `apps/web/lib/api.ts`).

## 3. Page-by-page walkthrough

### 3.1 Overview / Home — `app/(app)/page.tsx`
Landing view: **treasury balances**, wallet states, and recent spend activity at a glance — the
operator's cockpit.

### 3.2 Policies — `app/(app)/policies/page.tsx`
Create and manage the **deterministic rules** the policy engine evaluates. Fields: max per
transaction, monthly budget, human-approval threshold, velocity caps (spend/hour, payments/hour),
allowed action types, and the **vendor allow/deny lists** (whitelist/blacklist of beneficiaries).
Policies are **versioned & immutable** — "editing" creates a new version (`new-version`); the
previous is deactivated, preserving the audit history. Toggle active/inactive from the table.

### 3.3 Agents — `app/(app)/agents/page.tsx` (+ `agents/[id]/page.tsx`)
Create an agent → receive **two secrets shown once**: the API key (`cr_…`) and the signer secret
(the agent's Stellar signing key, used by the SDK to co-sign). Attach the agent to a wallet
(cost center), rotate its key, or revoke it. The detail page shows the agent's spend history and
status. Admin actions require a **human session** (RBAC — see §4 of the hardening evidence).

### 3.4 Wallets — `app/(app)/wallets/page.tsx`
Provision **non-custodial multisig wallets** (ADR 0007). The owner key is generated client-side
(mode GENERATED) or supplied (EXTERNAL); only the public key reaches the API. The dashboard drives
the on-chain multisig **setup** (owner signs, Aegis submits) → wallet becomes ACTIVE. The Aegis
co-signer key is derived per-company via HKDF; only public keys are persisted.

### 3.5 Vendors — `app/(app)/vendors/page.tsx`
Register payment beneficiaries with structured fields (name, website, category, contact email,
preferred asset). **Sponsor a wallet on-chain (CAP-33)** so the vendor receives USDC without ever
holding XLM. The table exposes the **Vendor ID** and **payTo public key** with one-click copy
(for SDK/x402 integration).

### 3.6 Spend Requests — `app/(app)/spend-requests/page.tsx`
Submit a spend request "acting as" an agent; the policy engine evaluates it and the row shows the
resulting status (`APPROVED` → `AWAITING_AGENT_SIGNATURE` → `EXECUTED`, `REQUIRES_APPROVAL`, or
`REJECTED`), the on-chain txHash (with stellar.expert link) and the failure reason if any.

### 3.7 Approvals (human-in-the-loop queue) — `app/(app)/approvals/page.tsx`
The **approval queue**: spend requests escalated to `REQUIRES_APPROVAL` (above the human-approval
threshold or velocity caps). A human **approves or rejects**; on approval the canonical envelope
is prepared for the agent to co-sign. Approval is **privative to a human session** — an agent API
key cannot approve its own spend (RBAC, PR #18).

### 3.8 Fiat ramp — `app/(app)/fiat/page.tsx`
On-ramp (deposit) and off-ramp (withdrawal) via the **Etherfuse anchor** (Pix/SPEI) and SEP-24.
Deposits credit a chosen wallet in USDC; withdrawals burn USDC and pay out to local fiat.
Withdrawals (money leaving) require a **human session** (RBAC).

### 3.9 Audit — `app/(app)/audit/page.tsx`
The **immutable audit trail**: every decision (`DECISION_MADE`, `PAYMENT_EXECUTED`,
`APPROVAL_GRANTED`, …) with the on-chain **Soroban** receipt hash when emitted. Each spend request
also stores a `policySnapshot` — proof of exactly which rules were in force at decision time.

## 4. End-to-end demo (reproducible)
A scripted, on-chain (testnet) run of the full governed-payout flow is provided at
`apps/api/src/scripts/treasury-demo.ts` — it exercises the same API the dashboard uses and shows a
payment **approved & executed**, one **escalated to human approval**, and one **blocked** (outside
the whitelist), plus the immutable audit trail:

```bash
pnpm --filter @aegis/api exec dotenv -e .env.local -- tsx src/scripts/treasury-demo.ts
```

## 5. How the dashboard talks to the API (security note)
All data fetching happens in **server components / server actions** (`apps/web/lib/api.ts`, `lib/actions.ts`).
The browser never holds an API key or the session token — the token is read server-side from the
httpOnly cookie via `getToken`/`decode`. Session expiry redirects cleanly to `/login`
(`apps/web/lib/auth.ts` maxAge aligned to the API session TTL).
