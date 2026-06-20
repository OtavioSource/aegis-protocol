# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Convenção: o código e os comentários deste repositório são em PT-BR. Mantenha esse padrão ao escrever código novo.

## O que é

Aegis Protocol — camada de **governança econômica** entre um agente de IA e o dinheiro. Recebe pedidos de gasto (fluxo HTTP 402 / x402), avalia contra políticas determinísticas, decide `APPROVED` / `REQUIRES_APPROVAL` / `REJECTED`, executa o pagamento on-chain em USDC na Stellar quando aprovado (o agente nunca tem a chave — a treasury do Aegis custodia e assina) e emite um recibo imutável via contrato Soroban.

## Comandos

Pré-requisitos: Node 22+, pnpm 10.5+, Docker (Postgres local), Rust + `stellar`/`soroban` CLI (para o contrato).

```bash
pnpm install                  # instala workspace (roda prisma generate via postinstall do @aegis/api)
docker compose up -d          # Postgres local em :5432 (user/pass/db = aegis)
pnpm dev                      # turbo: sobe API (:4000) + web (:3000) em watch
pnpm build                    # turbo build de todos os pacotes (respeita ^build)
pnpm test                     # turbo test (vitest) em todos os pacotes
pnpm typecheck                # tsc --noEmit em todos os pacotes
pnpm format                   # prettier --write
```

Rodar/testar um pacote isolado — use o filtro do turbo ou entre no diretório:

```bash
pnpm --filter @aegis/policy-engine test
pnpm --filter @aegis/api dev
```

Um único teste (vitest, dentro do pacote ou via filtro):

```bash
pnpm --filter @aegis/policy-engine exec vitest run src/__tests__/evaluate.test.ts
pnpm --filter @aegis/sdk exec vitest run -t "nome do teste"
```

API / banco (`apps/api`, scripts usam `dotenv -e .env.local`):

```bash
pnpm --filter @aegis/api db:migrate        # prisma migrate dev
pnpm --filter @aegis/api db:push           # prisma db push (sem migration)
pnpm --filter @aegis/api db:seed           # seed base
pnpm --filter @aegis/api db:seed:demo      # seed do dataset de demo
pnpm --filter @aegis/api db:studio         # Prisma Studio
pnpm --filter @aegis/api setup:treasury    # cria/funda treasury account na testnet
pnpm --filter @aegis/api setup:etherfuse   # configura anchor Etherfuse
```

Contrato Soroban (`contracts/aegis-audit`):

```bash
cd contracts/aegis-audit && cargo test          # testes unitários do contrato
stellar contract build                          # compila o WASM (perfil release)
```

> **lint:** `pnpm lint` existe mas é placeholder no `@aegis/api` (ESLint ainda não configurado lá). O `@aegis/web` usa `next lint`.

## Arquitetura

Monorepo Turborepo + pnpm. Workspaces: `apps/*`, `packages/*`, `examples/*`.

### Fluxo central (a coisa mais importante de entender)

Um pedido de gasto percorre: **SDK/HTTP → API orchestrator → Policy Engine (pura) → persistência → Payment Executor (on-chain) → Soroban audit**.

1. **`packages/policy-engine`** — `evaluate(request, policy, context)` é uma **função pura, síncrona, sem I/O**: sem `await`, rede, DB, `Date.now()` ou `Math.random()`. Determinística, não muta o input, **nunca dá `throw`** — retorna uma discriminated union `Decision`. Ordem canônica de regras: actionTypes → vendorDenyList (vence allowList) → vendorAllowList → maxPerTransactionCents → monthlyBudgetCents → humanApprovalThresholdCents (→ `REQUIRES_APPROVAL`) → fallback `APPROVED`. Não altere a ordem nem introduza I/O aqui.

2. **`apps/api/src/services/spend-request.ts`** — o orchestrator faz o I/O na borda: idempotência (`Idempotency-Key` + hash do body, único por `(companyId, idempotencyKey)`), resolve Agent → Policy ativa + Vendor, calcula o `RuntimeContext` (ex.: `monthlySpentCents` via agregação SQL de spend requests `EXECUTED`), invoca `evaluate()`, persiste `SpendRequest` + `AuditEvent` atomicamente numa `$transaction`, gravando um **`policySnapshot`** das regras no momento da decisão.

3. **`apps/api/src/services/payment-executor.ts`** — após `APPROVED`/`APPROVED_BY_HUMAN`, submete o Payment USDC on-chain. Idempotente via **lock otimista**: `updateMany` transiciona o status para `EXECUTING` atomicamente; corridas perdem o lock e retornam `noop`. Memo = `sha256(spendRequestId)`. Sucesso → `EXECUTED` + txHash/ledger; falha → `EXECUTION_FAILED` + `failureReason`. Dispara `emitSorobanAuditEvent` fire-and-forget.

4. **`contracts/aegis-audit`** (Rust/Soroban) — contrato global único. `record_decision(company_id, record)` exige `admin.require_auth()` e publica um evento com topics `("aegis", "decision", company_id)` — `company_id` indexado para consulta por tenant via Soroban RPC.

### Pacotes

- **`packages/shared`** (`@aegis/shared`) — fonte de verdade dos tipos. **Zod schemas** (`schemas.ts`) são canônicos; os tipos TS são derivados via `z.infer`. Contém enums, a discriminated union `Decision` + type guards, e a interface `SettlementAdapter` (extension point chain-agnóstico). Os enums do Prisma espelham os daqui — mantenha-os sincronizados.
- **`packages/stellar`** (`@aegis/stellar`) — implementação Stellar do `SettlementAdapter` + helpers: network/horizon/keypair, assets, encryption (AES-256-GCM para secret keys de vendor), friendbot, trustlines, SEP-10/SEP-24, anchor Etherfuse, **sponsoring (CAP-33)** e **payment / PathPaymentStrictReceive** (conversão de asset via DEX nativa), e `soroban-audit`.
- **`packages/policy-engine`** (`@aegis/policy-engine`) — a engine pura descrita acima.
- **`packages/sdk`** (`@aegis/sdk`) — cliente TS para agentes: `AegisClient` (pay/get/list), helpers x402 (`parsePaymentRequired`, `buildPaymentSignature`, `payX402`). Multi-runtime (Node/Bun/Deno/Workers).

### Apps

- **`apps/api`** (`@aegis/api`) — Fastify 5 + `fastify-type-provider-zod` (validação/serialização via Zod), Prisma + PostgreSQL (Neon em prod). Composição em [apps/api/src/app.ts](apps/api/src/app.ts): plugins (error-handler, observability/prom-client, helmet, cors, prisma, stellar, etherfuse, **auth-agent**, rate-limit) e depois as rotas. Entry local: [apps/api/src/server.ts](apps/api/src/server.ts); entry serverless (Vercel): `apps/api/api/index.ts`.
  - **Auth de agente** ([apps/api/src/plugins/auth-agent.ts](apps/api/src/plugins/auth-agent.ts)): `Authorization: Bearer cr_…`. Lookup por `apiKeyPrefix` (indexado) + `bcrypt.compare` (caro, ~10ms), com **cache LRU de 30s**. Rotas que mudam `Agent.status` (revoke/suspend/rotate-key) **devem** chamar `app.invalidateAgentCache(agentId)` para fechar a janela pós-revogação. `request.requireAgent()` exige auth; `request.companyId` deriva do agent.
  - **x402** ([apps/api/src/routes/x402.ts](apps/api/src/routes/x402.ts)): endpoints **públicos** `/v1/x402/verify` e `/settle` (vendor chama server-side). Modelo "pay-first": o Aegis liquida on-chain antes de devolver a prova, então `verify` confere o txHash direto no Horizon (o facilitator canônico do `@x402/stellar` não cobre esse caso).
- **`apps/web`** (`@aegis/web`) — Next.js 14 (App Router) + Tailwind + NextAuth. Dashboard do admin. **Todas as chamadas à API são server-side** via [apps/web/lib/api.ts](apps/web/lib/api.ts), usando uma service key `cr_` (`AEGIS_API_KEY`) que **nunca** chega ao browser; o humano é autenticado pelo NextAuth. Rotas em `app/(app)/*`.

### Modelo de dados

Schema em [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma). **Multi-tenant**: toda entidade tenant-bound carrega `companyId`. Valores monetários são **`BigInt` em centavos**. Entidades principais: Company, User, Agent, Policy (versionada via `supersedesPolicyId`), Vendor + VendorWallet, SpendRequest (com `policySnapshot` e máquina de estados em `SpendRequestStatus`), Approval, AuditEvent (com `sorobanTxHash` NULL até emissão on-chain), TreasuryAccount (secret **nunca** persistida — só o nome da env var), FiatDeposit/FiatWithdrawal (on/off-ramp via SEP-24 e Etherfuse).

## Convenções e armadilhas

- **`apps/api` é ESM** (`"type": "module"`) — imports relativos usam extensão `.js` mesmo apontando para `.ts`.
- **Env vars**: leia `process.env` **somente** em [apps/api/src/env.ts](apps/api/src/env.ts) (validação Zod, fail-fast no boot). O resto importa o `env` tipado. Scripts de dev carregam `.env.local`.
- **Schemas Zod são a fonte de verdade** dos tipos. Ao mudar shape de dados, comece pelo schema em `@aegis/shared`; os enums do Prisma precisam espelhar `@aegis/shared/enums`.
- **Não introduza I/O nem não-determinismo na policy-engine.**
- **Pacotes de lib não têm watch no `pnpm dev`.** Só `apps/api` e `apps/web` têm task `dev` (watch); as libs (`@aegis/shared`, `@aegis/policy-engine`, `@aegis/stellar`, `@aegis/sdk`) são consumidas pela API a partir do `dist/` buildado. Então, ao editar uma lib durante o `pnpm dev`, a mudança **não** recarrega sozinha: **rebuilde a lib e reinicie a API** — ex.: `pnpm --filter @aegis/policy-engine build` (e os `^build` dependentes) seguido de restart. Sintoma clássico: schema/validação novos pegam (a API rebuildou o que precisava no boot) mas a **lógica** da lib roda a versão antiga. O CI/Vercel não sofre disso (`turbo build` respeita `^build`); é só atrito do dev local.
- **Idempotência e locks otimistas** são intencionais (spend-request e payment-executor) — preserve a atomicidade das `$transaction` ao mexer nesses fluxos.
- **`docs/` é gitignored** (docs internas) mas existe localmente e é referenciada pelos comentários (ADRs `docs/adr/000x`, `docs/0x-*.md`). Consulte-as para o "porquê" das decisões; elas não estão no controle de versão público.
