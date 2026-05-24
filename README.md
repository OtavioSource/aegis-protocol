# Aegis Protocol

> Camada de governança econômica para agentes de IA que pagam autonomamente — auditável on-chain, com fricção zero para quem usa.

[![Status](https://img.shields.io/badge/status-MVP%20em%20constru%C3%A7%C3%A3o-orange)]()
[![Network](https://img.shields.io/badge/network-Stellar%20Testnet-blue)]()
[![License](https://img.shields.io/badge/license-TBD-lightgrey)]()

---

## O problema

Agentes de IA já estão pagando por coisas em produção — APIs de LLM, scrapers, ferramentas SaaS, microserviços que cobram por chamada. O código de status **HTTP 402 ("Payment Required") existe há anos** na especificação HTTP, mas só agora — com o avanço dos agentes de IA e da infraestrutura blockchain — está se tornando **viável** como meio de pagamento real; padrões emergentes como **MPP** (Stripe/Tempo) e **x402** (Coinbase) já estão padronizando esse fluxo.

O que **não existe** é uma camada de **governança e auditoria** entre o agente e o dinheiro. Um agente com uma credencial pode gastar sem checagem de política por transação, sem teto de orçamento e sem ponto de aprovação humana. As alternativas atuais não cobrem isso:

1. **Cartão corporativo / Stripe Issuing** — têm controles de gasto e autorização em tempo real, mas não foram feitos para pagamentos agente→fornecedor baseados em HTTP 402, liquidação on-chain, nem para gerar um comprovante de cada gasto que qualquer pessoa possa verificar de forma independente.
2. **Controles ad-hoc dentro do próprio agente** — cada time reinventa rate limit, orçamento e aprovação humana, mal-feito e sem auditoria externa.

Os meios de pagamento para agentes estão surgindo rápido — a camada de controle por cima deles continua em aberto.

## A solução

**O Aegis não é mais um meio de pagamento. É a camada de governança que decide se um agente de IA pode gastar — antes do dinheiro se mover.**

O **Aegis Protocol**:

- **Recebe pedidos de gasto** via API REST + SDK TypeScript, no fluxo HTTP 402.
- **Avalia contra políticas determinísticas** em milissegundos — engine pura, sem I/O.
- **Decide:** `APPROVED`, `REQUIRES_APPROVAL` (exige aprovação humana) ou `REJECTED` — sempre com justificativa.
- **Executa o pagamento on-chain** na Stellar (USDC) quando aprovado — o agente **nunca** tem a chave; o Aegis custodia e assina.
- **Emite recibo imutável** via contrato Soroban — cada decisão vira um evento on-chain consultável.
- **Dashboard web** para o admin: políticas, vendors, agentes, fila de aprovação humana, saldos da treasury e fiat ramp.

### Diferenciais técnicos

🪶 **Fricção zero de blockchain** — usa Sponsored Reserves (CAP-33) e Fee Bump (CAP-15) da Stellar. Vendor e Company **nunca precisam ter XLM nem entender de blockchain**. O vendor recebe em **USDC** ou outro asset Stellar (ex.: EURC), com conversão automática via DEX nativa (Path Payment Strict Receive). Onboarding em segundos.

💵 **Fiat on/off-ramp integrado** — via anchor **Etherfuse** (BRL/MXN com Pix/SPEI). A Company deposita em moeda local e a treasury recebe USDC; e converte USDC de volta para fiat quando precisa. *(Pagar o fornecedor direto em fiat — Pix/conta bancária — é roadmap via SEP-31.)*

🔐 **Agente sem custódia** — o agente nunca tem acesso à chave Stellar; só o Aegis. Política e chave separadas por design.

📜 **Auditoria verificável** — um contrato Soroban global emite um comprovante on-chain a cada decisão, com `companyId` indexado como topic. Qualquer pessoa pode consultar e verificar esse histórico de forma independente, via Soroban RPC.

🔒 **Kill switch** (stretch goal) — quando ativado, um asset Aegis-issued com `AUTH_CLAWBACK_ENABLED` permite revogar tokens de uma treasury comprometida via Clawback.

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
