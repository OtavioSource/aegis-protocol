# Aegis Protocol — Hackathon Submission

## Solana Frontier Hackathon (Colosseum) · Deadline: May 11, 2026

---

## What Was Built

Aegis Protocol is an **economic governance layer for AI agents** — a control plane that lets companies deploy autonomous AI agents with real spending capability on Solana, without losing control.

### Four Solana-native features (the package that can't be replicated on EVM):

1. **Token-2022 + Permanent Delegate** — kill switch is cryptographically enforced on-chain, not just a DB flag. When activated, the Aegis Permanent Delegate sweeps the frozen treasury's token balance to quarantine via an on-chain `transferChecked`. Verifiable on Solana Explorer.

2. **cNFT Audit Receipts (Metaplex Bubblegum)** — every policy decision (APPROVED / REJECTED / REQUIRES_APPROVAL) mints a compressed NFT, creating a tamper-proof on-chain audit log at $0.00005/receipt. One Merkle tree per company, 16,384 receipts capacity, lazily initialized on first spend request.

3. **Solana Pay** — vendors generate `solana:<wallet>?amount=...&reference=...` invoice URIs. Agents call `aegis.pay(uri)` in the SDK — same policy governance, same cNFT receipt, on-chain reference tracking per the SIMD-0057 spec.

4. **SettlementAdapter interface** — `@aegis/shared` defines a chain-agnostic `SettlementAdapter` that `TreasuryService` (Solana) implements. Adding Stellar requires implementing the same interface, no governance changes.

---

## Submission Checklist

### Code & Repository
- [ ] GitHub repo is public: https://github.com/OtavioSource/aegis-protocol
- [ ] `pnpm install && docker compose up -d && pnpm dev` works from scratch
- [ ] Policy engine tests pass: `pnpm --filter @aegis/policy-engine test`
- [ ] All packages build: `pnpm build`
- [ ] Demo script runs: `pnpm --filter @aegis/api demo`

### Solana Integration
- [x] Token-2022 mint with Permanent Delegate extension (packages/solana/src/devnet-fund.ts)
- [x] Real SPL/Token-2022 token transfers on devnet (packages/solana/src/treasury.ts)
- [x] On-chain kill switch via Permanent Delegate sweep (freezeTreasury())
- [x] cNFT audit receipts via Metaplex Bubblegum (packages/solana/src/receipts.ts)
- [x] Solana Pay URI generation (packages/solana/src/solana-pay.ts)
- [x] Solana Pay SDK method (packages/sdk/src/client.ts → aegis.pay())
- [x] txSignature stored in DB and linkable to Solana Explorer
- [x] SettlementAdapter interface for multi-chain extensibility

### Dashboard
- [ ] Overview page with live stats
- [ ] Agents page with kill switch toggle
- [ ] Approvals queue with approve/reject
- [ ] Spend requests table with Explorer links
- [ ] Audit log with cNFT receipt links

### Videos
- [ ] **Pitch video** (3 min): Problem → Solution → Solana-native features → Market
  - Problem: AI agents need economic autonomy but governance doesn't exist
  - Solution: Aegis Protocol = control plane for agent spending, 4 Solana-native features
  - Demo: show all 5 scenarios (auto-approve, approval flow, blocked vendor, kill switch, Solana Pay)
  - Market: every company deploying AI agents in 2026+

- [ ] **Technical demo** (2-3 min):
  - Run `pnpm demo` showing all scenarios in terminal
  - Show Solana Explorer: SPL transfer, Permanent Delegate sweep, cNFT on tree
  - Open dashboard: audit log with cNFT receipt links, kill switch toggle

### Submission Form
- [ ] Project name: Aegis Protocol
- [ ] Tagline: Economic governance layer for AI agents on Solana
- [ ] Category: AI + Infrastructure
- [ ] GitHub URL: https://github.com/OtavioSource/aegis-protocol
- [ ] Live demo URL: (Vercel deploy)
- [ ] Pitch video URL: (YouTube/Loom)
- [ ] Tech demo URL: (YouTube/Loom)

---

## Monetization Plan

```
Free tier:   1 agent, basic policies, 100 tx/month
Pro $49/mo:  10 agents, advanced policies, unlimited tx, cNFT receipts
Enterprise:  $499/mo — unlimited agents, custom policies, SLA, Permanent Delegate per tenant
Volume fee:  0.1% of governed transaction volume (cap $1/tx)
```

## User Acquisition

```
1. Tweet thread: "We built a kill switch for AI agents — backed by Solana's Permanent Delegate"
2. Post in LangChain Discord, CrewAI Discord, AutoGPT community
3. Contact AI agent builders at YC companies with early access
4. Landing page with email capture + Solana Pay demo GIF
5. Kill switch demo clip: show Permanent Delegate sweep on Solana Explorer (visually dramatic)
```

---

## Deploy Instructions

### Web (Vercel)
1. Connect GitHub repo to Vercel
2. Root directory: `apps/web`
3. Env vars: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_COMPANY_ID`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
4. Deploy

### API (Railway)
1. Connect GitHub repo to Railway
2. Root directory: `apps/api`
3. Set all env vars from `apps/api/.env.example`
4. Add PostgreSQL plugin (or point to Neon)
5. Deploy

### Database (Neon)
1. Create project at neon.tech
2. Copy connection string → `DATABASE_URL`
3. `pnpm --filter @aegis/api db:migrate`
4. `pnpm --filter @aegis/api db:seed`

### Solana Setup (devnet)
1. Generate delegate keypair and set `AEGIS_DELEGATE_SECRET`
2. Fund delegate with devnet SOL via faucet
3. Call `/fund-demo` → save `mintAddress` as `DEVNET_DEMO_MINT_ADDRESS`
4. Optionally set `AEGIS_QUARANTINE_ADDRESS` for quarantine wallet

---

## Demo Script (for recording)

```bash
# Terminal 1 — Start everything
docker compose up -d && pnpm dev

# Terminal 2 — Run the demo (record this)
pnpm --filter @aegis/api demo

# Browser — Show dashboard (record this)
open http://localhost:3000/dashboard
open http://localhost:3000/dashboard/audit
```

### Scenarios to show on-screen

1. **Auto-approve + SPL transfer**: small request → APPROVED → execute → show Explorer link
2. **Human approval flow**: medium request → REQUIRES_APPROVAL → admin approves → transfer
3. **Vendor block**: blocked vendor → REJECTED → policy reason shown
4. **Kill switch**: activate → all requests blocked → show Explorer for Permanent Delegate sweep tx
5. **Solana Pay**: vendor QR URI → agent `pay(uri)` → governed transfer + cNFT receipt

---

## Key Talking Points

1. **Kill switch is on-chain, not just a DB flag** — When activated, the Aegis Permanent Delegate (Token-2022 extension) sweeps all tokens from the frozen treasury on-chain. Nobody can undo this without the delegate keypair. Show the sweep transaction on Solana Explorer.

2. **Every audit event is a cNFT** — The audit trail lives on Solana, not just in our Postgres. 16,384 receipts per company at $0.00005 each. At 10,000 decisions/day, that's $0.50/day for a tamper-proof on-chain audit log.

3. **Solana Pay wires vendor invoicing into the governance loop** — Vendors issue invoices as standard Solana Pay URIs. Agents pay via `aegis.pay(uri)`. Policy still evaluates. cNFT still mints. This is "Solana Pay as governance infrastructure."

4. **SDK is 4 lines to integrate** — any agent capable of HTTP can submit a governed spend request and wait for the result. `aegis.pay(uri)` makes it even simpler for vendor invoice flows.

5. **SettlementAdapter makes multi-chain credible** — Stellar, EVM, or any chain can be added by implementing the interface without touching the policy engine or API routes.

6. **Policy engine is production-grade** — pure TypeScript, zero I/O, 17 unit tests, deterministic. Not hackathon code.
