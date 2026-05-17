# Aegis Protocol

> Camada de governança econômica para agentes de IA que pagam autonomamente — auditável on-chain, com fricção zero para quem usa.

[![Status](https://img.shields.io/badge/status-MVP%20em%20constru%C3%A7%C3%A3o-orange)]()
[![Network](https://img.shields.io/badge/network-Stellar%20Testnet-blue)]()
[![License](https://img.shields.io/badge/license-TBD-lightgrey)]()

---

## O problema

Agentes de IA estão começando a pagar por coisas em produção — APIs LLM, scrapers, ferramentas SaaS, microserviços que cobram por chamada via **HTTP 402 Payment Required**. Mas **não existe hoje uma camada de governança e auditoria desses gastos autônomos**. CTOs e founders ficam com três opções ruins:

1. **Dar um cartão corporativo ao agente** — sem controle granular, auditoria fraca, expostos a fraude.
2. **Stripe Issuing / virtual cards** — taxa alta, settlement lento, ainda assim sem trilha cripto-verificável.
3. **Codar controles ad-hoc no próprio agente** — cada projeto reinventa rate limits, budgets e aprovação humana, mal-feito e sem auditoria externa.

## A solução

**Aegis Protocol** é um gateway de pagamento para agentes de IA com governança econômica embutida:

- **Recebe pedidos de gasto** via REST + SDK TypeScript com `Authorization: Bearer cr_...`.
- **Avalia contra políticas customizáveis** em milissegundos — engine determinística, zero I/O.
- **Decide:** `APPROVED`, `REQUIRES_APPROVAL` (escala para humano), ou `REJECTED` com justificativa.
- **Executa pagamento on-chain real** na Stellar (USDC via SEP-24 anchor) — testnet primeiro, mainnet depois.
- **Emite recibo imutável** via contrato Soroban — cada decisão vira evento on-chain consultável.
- **Dashboard web** para admin: políticas, vendors, agentes, aprovações humanas, fiat ramp.

### Diferenciais técnicos

🪶 **Fricção zero blockchain** — Aegis usa Sponsored Reserves (CAP-33) e Fee Bump (CAP-15) da Stellar. Vendor e Company **nunca precisam ter XLM nem entender blockchain**. Vendor escolhe receber em **USDC, EURC, BRL** ou outra moeda suportada por anchor — Aegis converte automaticamente via DEX nativa Stellar (Path Payment Strict Receive). Onboarding em segundos.

💵 **Fiat in/out integrado** — SEP-24 anchor (testnet: `testanchor.stellar.org`, mainnet futuro: Circle, Anclap, MoneyGram). Company deposita em moeda local, agente paga em USDC, vendor recebe na moeda que preferir (USDC/EURC/BRL/...) ou converte fiat de volta.

🔐 **Custódia simétrica** — agente **nunca** tem acesso à chave Stellar; Aegis tem. Política e chave separadas por design.

📜 **Auditoria cripto-verificável** — contrato Soroban global emite evento por decisão, com `companyId` indexado como topic. Histórico permanente, queryable via Soroban RPC.

🔒 **Kill switch** (stretch goal) — quando ativado, asset Aegis-issued com `AUTH_CLAWBACK_ENABLED` permite revogar tokens da treasury comprometida via operação Clawback. Visível no Stellar Expert.

---

## Quickstart (em breve)

```bash
# Pré-requisitos: Node 22+, pnpm 10+, Rust + soroban-cli, Docker
pnpm install
pnpm dev
```

(Detalhes em [docs/02-architecture.md](docs/02-architecture.md) e roadmap iterativo em [docs/11-roadmap.md](docs/11-roadmap.md).)

---

## Documentação

A documentação está organizada para você ler na ordem se for novo no projeto, ou pular direto ao tópico que precisa.

### Produto
- [00 — Visão](docs/00-vision.md) — persona, problema, JTBD, posicionamento competitivo
- [01 — Requisitos (PRD)](docs/01-requirements.md) — RFs do MVP, RNFs, stretch goals, fora de escopo

### Arquitetura
- [02 — Arquitetura](docs/02-architecture.md) — C4 macro: Context, Container, Sequence
- [03 — Domain Model](docs/03-domain-model.md) — entidades, agregados, invariantes, glossário

### Stellar / Soroban
- [04 — Stellar Asset Design](docs/04-stellar-asset-design.md) — USDC operacional, treasury, accounts
- [05 — Zero-Friction Onboarding](docs/05-zero-friction-onboarding.md) — Sponsored Reserves + Fee Bump
- [06 — Fiat On/Off-ramp (SEP-24)](docs/06-fiat-onramp-sep24.md) — deposit/withdraw via anchor

### Interface técnica
- [07 — API Contract](docs/07-api-contract.md) — endpoints REST, auth, idempotência
- [08 — Soroban Audit Contract](docs/08-soroban-audit.md) — contrato global, eventos, topics
- [09 — Policy DSL](docs/09-policy-dsl.md) — formato JSON das políticas

### Operação
- [10 — Security & Threat Model](docs/10-security.md) — atores, mitigações, limitações
- [11 — Roadmap](docs/11-roadmap.md) — MVP → Hardening → Mainnet → Scale

### Decisões arquiteturais
- [ADRs (Architecture Decision Records)](docs/adr/) — decisões D1-D12 com contexto e consequências

---

## Status atual

**Fase:** Bootstrap (documentação + scaffolding do monorepo). Veja o [roadmap iterativo](docs/11-roadmap.md) para o que vem em seguida.

**Network:** Stellar Testnet (anchor: `testanchor.stellar.org`).

**Stack:** TypeScript + Fastify (API) · Next.js 14 + Tailwind (web) · Prisma + PostgreSQL (Neon) · Rust + Soroban (audit contract) · Turborepo + pnpm.

---

## Contribuindo

Por enquanto este é um projeto fechado em fase de fundação. Documentação e ADRs descrevem o porquê de cada decisão — leia-os antes de propor mudanças.

## Licença

A definir.
