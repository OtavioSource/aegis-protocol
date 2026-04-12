# Aegis Protocol — Hackathon Submission Checklist

## Solana Frontier Hackathon (Colosseum) · Deadline: May 11, 2026

---

## Submission Checklist

### Code & Repository
- [ ] GitHub repo is public
- [ ] README.md complete (architecture, setup, API docs)
- [ ] `pnpm install && docker compose up -d && pnpm dev` works from scratch
- [ ] All 17 policy engine tests pass (`pnpm --filter @aegis-protocol/policy-engine test`)
- [ ] Demo script runs cleanly (`pnpm --filter @aegis-protocol/api demo`)

### Solana Integration
- [ ] Real SPL token transfers on devnet (not simulated)
- [ ] `txSignature` stored and visible in dashboard
- [ ] Solana Explorer links working in audit log
- [ ] Treasury wallet funded and operational
- [ ] Kill switch implemented and tested

### Dashboard
- [ ] Overview page with live stats
- [ ] Agents page with kill switch toggle
- [ ] Approvals queue with approve/reject
- [ ] Spend requests table with Explorer links
- [ ] Audit log with event timeline

### Videos
- [ ] **Pitch video** (3 min): Problem → Solution → Market → Demo
  - Problem: AI agents need economic autonomy but no governance exists
  - Solution: Aegis Protocol = control plane for agent spending
  - Demo: show the 4 scenarios in the dashboard
  - Market: every company deploying AI agents in 2026+
- [ ] **Technical demo** (2-3 min): CLI demo + dashboard walkthrough
  - Run `pnpm demo` showing all 4 scenarios in terminal
  - Open dashboard showing spend requests, audit log
  - Click Solana Explorer link for a real transaction

### Submission Form
- [ ] Project name: Aegis Protocol
- [ ] Tagline: Economic governance layer for AI agents on Solana
- [ ] Category: AI + Infrastructure
- [ ] GitHub URL: https://github.com/aegis-protocol/aegis-protocol
- [ ] Live demo URL: https://aegis.vercel.app
- [ ] Pitch video URL: (YouTube/Loom)
- [ ] Tech demo URL: (YouTube/Loom)

### Monetization Plan (for form)
```
Free tier:   1 agent, basic policies, 100 tx/month
Pro $49/mo:  10 agents, advanced policies, unlimited tx
Enterprise:  $499/mo — custom policies, SLA, dedicated treasury

Alternative: 0.1% fee on governed transaction volume (cap $1/tx)
Vision: "Stripe for AI agent payments"
```

### User Acquisition (for form)
```
1. Tweet thread on Day 1 with demo GIF
2. Post in r/AI_Agents, LangChain Discord, CrewAI Discord
3. Contact 5 AI agent builders for early access
4. Landing page at aegis.io with email capture
5. 30s kill switch clip on Twitter/X (visually dramatic)
```

---

## Deploy Instructions

### Web (Vercel)
1. Connect GitHub repo to Vercel
2. Set root directory to `apps/web`
3. Set env vars: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_COMPANY_ID`
4. Deploy

### API (Railway)
1. Connect GitHub repo to Railway
2. Set root directory to `apps/api`
3. Set env vars from `.env.example`
4. Add PostgreSQL plugin (or use Neon)
5. Deploy

### Database (Neon)
1. Create project at neon.tech
2. Copy connection string to `DATABASE_URL`
3. Run: `pnpm --filter @aegis-protocol/api db:migrate`
4. Run: `pnpm --filter @aegis-protocol/api db:seed`

---

## Demo Script Execution Order (for recording)

```bash
# Terminal 1 — Start everything
docker compose up -d
pnpm dev

# Terminal 2 — Run the demo (record this)
pnpm --filter @aegis-protocol/api demo

# Browser — Show dashboard (record this)
open http://localhost:3000/dashboard
open http://localhost:3000/dashboard/audit
```

## Key Talking Points

1. **Problem is real today** — LangChain, CrewAI, AutoGPT agents are being deployed in production without economic controls

2. **Solana is structural** — not cosmetic. Real SPL transfers, real wallet keypairs, real tx signatures on Explorer. Devnet today, mainnet-ready architecture.

3. **Policy engine is pure and testable** — zero I/O, deterministic, 17 unit tests. This is production-grade, not hackathon code.

4. **SDK is 4 lines** — any agent with HTTP capability can integrate in minutes

5. **Kill switch is the "wow" moment** — visually dramatic, instantly understandable, solves a real safety problem

6. **Audit log is the trust layer** — every decision logged immutably with policy snapshot. Compliance teams love this.
