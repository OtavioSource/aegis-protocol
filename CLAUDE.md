# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@PRD.md

> [PRD.md](PRD.md) is the **single source of truth** for product, persona, architecture, and ADRs (auto-loaded above). When this file conflicts with PRD.md, PRD.md wins. Never revoke or contradict a registered ADR without proposing a new one and getting owner approval.

> The product is **Aegis Protocol**. All package names use the `@aegis/*` scope.

---

## Product Scope (read first)

Aegis Protocol is a **governance layer** (control plane + REST API) for AI agents that need controlled economic autonomy on Solana. It is **not** an agent framework, an LLM orchestrator, a wallet app, a generic crypto dashboard, or a procurement ERP.

### Core loop
```
Agent requests spend → Policy evaluates → System decides → cNFT receipt minted → Treasury executes (SPL transfer)
```

### Priority order when making implementation tradeoffs
1. clear product narrative
2. strong governance flow
3. meaningful Solana relevance (Solana-native, not cosmetic)
4. fast hackathon-MVP execution
5. extensibility after the hackathon

### Always frame as
governance layer for AI agents · economic control plane · controlled autonomy · programmable treasury on Solana.

### Never frame as
AI wallet app · crypto dashboard · chatbot with payments.

### Hackathon
Solana Frontier Hackathon (Colosseum) — submission deadline **2026-05-11**.

---

## Common Commands

All commands run from the repo root unless noted. Node 22+ and pnpm 10+ required.

### One-time setup
```bash
pnpm install
docker compose up -d                          # Postgres on :5433, optional local solana-test-validator on :8899
pnpm --filter @aegis/api db:migrate           # Prisma migrations
pnpm --filter @aegis/api db:seed              # Demo data + admin user
cp apps/api/.env.example apps/api/.env        # Fill in DB URL, AEGIS_DELEGATE_SECRET, mint address
```

### Daily development
```bash
pnpm dev                                      # Turbo: runs api (:3001) + web (:3000) + watch builds
pnpm build                                    # Build all packages (also serves as type-check)
pnpm lint                                     # Per-workspace lint (mostly `tsc --noEmit`)
pnpm test                                     # All vitest suites
pnpm format                                   # Prettier across ts/tsx/md/json
```

### Per-package
```bash
pnpm --filter @aegis/api dev                  # Fastify API only (tsx watch with --env-file=.env)
pnpm --filter @aegis/web dev                  # Next.js dashboard only
pnpm --filter @aegis/policy-engine test       # Policy unit tests (pure, deterministic, fast)
pnpm --filter @aegis/policy-engine test -- evaluate.test.ts -t "kill switch"   # Single test
pnpm --filter @aegis/api db:studio            # Prisma Studio
pnpm --filter @aegis/api demo                 # Animated end-to-end demo (requires funded treasury)
```

### Solana devnet bootstrap
```bash
# Generate the Permanent Delegate keypair (paste into apps/api/.env as AEGIS_DELEGATE_SECRET)
node -e "const {Keypair}=require('@solana/web3.js');const kp=Keypair.generate();console.log(kp.publicKey.toBase58());console.log('AEGIS_DELEGATE_SECRET='+Buffer.from(kp.secretKey).toString('base64'))"

# Fund treasury with Token-2022 demo tokens (after seed prints COMPANY_ID/TREASURY_ID)
curl -X POST http://localhost:3001/companies/$COMPANY_ID/treasuries/$TREASURY_ID/fund-demo \
  -H "Content-Type: application/json" -d '{"amount": 10000}'
# Save returned mintAddress as DEVNET_DEMO_MINT_ADDRESS in apps/api/.env
```

The `apps/api` server requires `dotenv/config` to load **before** any local import that references `process.env` (notably `@aegis/solana`, which reads `SOLANA_RPC_URL` at module load). Don't reorder imports in [apps/api/src/server.ts](apps/api/src/server.ts).

---

## Architecture

### Monorepo (Turborepo + pnpm workspaces)
```
apps/
  api/        Fastify REST API (composition root: src/server.ts)
  web/        Next.js dashboard (App Router, NextAuth Credentials)
packages/
  shared/         Zod schemas, enums, domain types, SettlementAdapter interface
  policy-engine/  Pure evaluate() — zero I/O, deterministic, vitest-tested
  solana/         Token-2022 treasury, cNFT receipts, Solana Pay URI, devnet funding
  stellar/        Second SettlementAdapter implementation (multi-chain proof)
  sdk/            TypeScript client for AI agents (requestAndExecute, pay, waitForApproval)
examples/         ai-agent, simple-agent — usage demos for the SDK
prisma/
  schema.prisma   10-entity domain model
  migrations/
docker-compose.yml  postgres + solana-test-validator
```

Package names use `@aegis/*` (e.g. `@aegis/api`, `@aegis/policy-engine`). The root `package.json` is named `aegis-protocol`.

### Domain model — 10 entities
1. **Company** — tenant; holds the Bubblegum Merkle tree address for cNFT receipts
2. **Vendor** — payment recipient with a real Solana wallet (separate from string-based vendor names in policy rules)
3. **Treasury** — Solana wallet + Token-2022 config (`encryptedSecret` is server-side only, **never serialized**)
4. **Agent** — registered agent with `apiKeyHash` (SHA-256, indexed) and `killSwitchActive`
5. **Policy** — governance rules as JSON (`rules` field), validated by Zod at the API boundary
6. **Budget** — daily/monthly/per-tx limits, `Decimal(18, 6)` to avoid USDC float errors; **one budget per agent** (`@unique` on `agentId`)
7. **SpendRequest** — central entity; lifecycle `PENDING → APPROVED|REJECTED|REQUIRES_APPROVAL → EXECUTED|FAILED`
8. **ApprovalRequest** — 1:1 with SpendRequest, only created when the engine returns `REQUIRES_APPROVAL`
9. **User** — dashboard human (bcrypt password hash, role: OWNER/ADMIN/VIEWER)
10. **AuditLog** — immutable, indexed on `(companyId, createdAt)` and `(agentId, createdAt)`; `payload` is freeform JSON keyed by `eventType`

### Policy engine ([packages/policy-engine](packages/policy-engine))
Lives behind one function: `evaluate(EvaluationContext) → PolicyEvaluationResult`. Rules run **top-to-bottom**, first match wins:

1. `kill_switch` — agent emergency stop (also triggers on-chain Permanent Delegate sweep at the API layer)
2. `agent_disabled`
3. `action_type_not_allowed`
4. `vendor_denied`
5. `vendor_not_allowed`
6. `per_transaction_limit_exceeded`
7. `max_transaction_amount_exceeded`
8. `daily_budget_exceeded`
9. `monthly_budget_exceeded`
10. `require_approval_above` (escalates instead of rejects)
11. fall-through → `APPROVED`

**Hard rules:** the engine must remain pure (no DB, HTTP, time, or randomness inside). The API layer is responsible for fetching daily/monthly spend totals and budget rows, then passing them in. Adding a rule means adding a unit test in [packages/policy-engine/src/__tests__/evaluate.test.ts](packages/policy-engine/src/__tests__/evaluate.test.ts).

### API ([apps/api](apps/api))
Fastify + Zod, with route modules registered in [apps/api/src/server.ts](apps/api/src/server.ts). Routes are split: `companies`, `agents`, `spend-requests` (the core flow), `approvals`, `audit`, `vendors`, `users`. Auth: agents use `Authorization: Bearer cr_...` (validated against `Agent.apiKeyHash`); the dashboard hits `/auth/login` for NextAuth.

Conventions:
- routes are thin; business logic in `src/services/*`
- `Treasury.encryptedSecret` is stripped at the route layer before any JSON serialization
- Solana logic is **never** imported directly in routes — go through `@aegis/solana` adapters

### Solana integration ([packages/solana](packages/solana))
Solana is structural. Implement these patterns; do **not** add custom Anchor programs or mainnet logic.

- **Token-2022 + Permanent Delegate** — kill switch isn't just a DB flag. `freezeTreasury()` performs an on-chain `transferChecked` from the Permanent Delegate authority (`AEGIS_DELEGATE_SECRET`) sweeping balances to a quarantine wallet. Visible on Solana Explorer.
- **cNFT audit receipts (Metaplex Bubblegum + UMI)** — every policy decision mints a compressed NFT. One Merkle tree per Company (`maxDepth=14`, ~16k receipts), created lazily on first spend request.
- **Solana Pay URIs** — `GET /vendors/:id/solana-pay-uri` builds spec-compliant `solana:` URIs with a fresh reference keypair per invoice. The SDK's `aegis.pay(uri)` parses → governed SpendRequest → same flow.
- **SettlementAdapter** — interface in `@aegis/shared` with `createWallet()`, `transfer()`, `freeze()`, `getBalance()`. `TreasuryService` (Solana) implements it; `@aegis/stellar` proves multi-chain extensibility. Governance logic must depend only on the interface.

### Web dashboard ([apps/web](apps/web)) — IMPORTANT
**This Next.js version has breaking changes vs. training data.** Per [apps/web/AGENTS.md](apps/web/AGENTS.md): consult `node_modules/next/dist/docs/` (and heed deprecation notices) before writing routing, server-component, or build-config code in `apps/web`. The repo runs Next.js 16 + React 19 + Tailwind v4 + NextAuth 5 (beta) + Turbopack. Do not assume App Router APIs you remember are still current.

NextAuth is configured in [apps/web/auth.ts](apps/web/auth.ts) and validates via the API's `/auth/login`. The session JWT carries `role` and `companyId`.

---

## Engineering Standards

- Strict TypeScript everywhere (`strict`, `noImplicitAny`, `noUnusedLocals`, `exactOptionalPropertyTypes` are on in [tsconfig.base.json](tsconfig.base.json))
- Thin routes, business logic in services
- Policy logic separate from persistence
- Solana logic isolated behind `SettlementAdapter` / `@aegis/solana` exports
- Prefer explicit domain models; small, testable modules
- Use `Decimal(18, 6)` for any USDC amount in Prisma; never `Float`/`Number` for money
- The `Policy.rules` JSON shape is enforced by Zod in `@aegis/shared` — update the schema when adding rule types

## Non-goals (do not build)

- a full agent runtime
- generic chat UX or LLM orchestration tooling
- a procurement ERP
- mainnet-anything (devnet is sufficient for the hackathon)
- custom on-chain programs (use SPL / Token-2022 / Bubblegum primitives)
- complex multi-sig (server holds delegate authority by design)
- speculative abstractions ahead of the second concrete use case
