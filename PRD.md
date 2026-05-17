# Aegis Protocol — Documento Vivo de Produto

> **Tipo:** Documento Vivo (ADR + RT + PRD consolidados).
> **Status:** Camadas chain-agnostic construídas; adapter Stellar em implementação; hipótese de mercado em validação.
> **Última atualização:** 2026-05-09
> **Owner:** Otávio Silva (otavioaraujo.es@gmail.com)

---

## 0. Como usar este documento

Este é o **mapa único** do Aegis Protocol. Toda decisão importante de produto, arquitetura, tecnologia ou posicionamento é registrada aqui. Atualize a cada novo aprendizado, entrevista, dado ou pivot.

- **Para o avaliador (programa / investidor / advisor):** comece pela seção [§1](#1-produto-em-uma-frase) e termine em [§13](#13-status-atual).
- **Para o autor:** atualize ao fim de cada bloco de 5 entrevistas, ao tomar uma decisão arquitetural nova, ou ao mudar de hipótese. Sempre incremente o histórico em [§14](#14-histórico-de-revisões).
- **Para Claude Code (qualquer instância futura):** este documento é fonte de verdade. **Nunca** contradiga uma decisão registrada na seção de ADRs ([§9](#9-decisões-de-produto-adrs)) sem antes propor uma nova ADR e obter aprovação do owner. Em caso de conflito entre este documento e [README.md](README.md) / [SUBMISSION.md](SUBMISSION.md) / [ONE-PAGER.md](ONE-PAGER.md), **este documento vence**.

---

## 1. Produto em uma frase

> **Aegis Protocol é a camada de governança econômica entre agentes de IA e o trilho de pagamento — controla, audita e libera (ou bloqueia) gastos autônomos via Stellar.**

Analogia curta: **"Stripe para pagamentos de agentes de IA, com regras de política, kill switch criptográfico e auditoria on-chain — rodando em Stellar para liquidação cross-border de baixo custo."**

---

## 2. Problema

Empresas estão deployando agentes de IA em produção (LangChain, CrewAI, agentes da OpenAI, wrappers proprietários) que precisam executar gastos: pagar APIs, comprar dados, renovar serviços, contratar ferramentas. Hoje só existem dois caminhos ruins:

1. **Bloquear tudo** → perde-se a automação que justifica o agente.
2. **Liberar tudo** (cartão corporativo + chave de API) → perde-se controle do caixa, sem trilha de auditoria por agente, com risco de runaway custando $10k+ em horas.

Não existe camada de governança financeira entre o agente e o dinheiro — e quando o caso é cross-border (vendor em outro país, moeda local), o problema cresce: liquidação lenta, FX caro, off-ramp sem trilha auditável.

---

## 3. Solução

Uma API de governança que:

1. Recebe pedidos de gasto do agente (REST + SDK TypeScript).
2. Avalia contra políticas customizáveis em milissegundos (10 regras em ordem de prioridade — engine pura, determinística, zero I/O).
3. Decide: aprova, escala para humano, ou rejeita com justificativa.
4. Executa pagamento on-chain real (Stellar Payment / Path Payment em testnet).
5. Gera recibo on-chain imutável (evento emitido por contrato Soroban — custo desprezível).
6. Oferece kill switch criptograficamente enforçado via `AUTH_CLAWBACK_ENABLED` no asset issuer + operação `Clawback`, não apenas flag em DB.

### Core loop

```
Agente solicita gasto → Política avalia → Sistema decide → Soroban emite evento de auditoria → Treasury executa (Stellar Payment)
```

---

## 4. Persona (hipótese em validação)

### V1 atual — Hipótese 1: LLM Inference

**Persona:** CTO ou founder técnico de startup em fase seed/Series A (10–100 funcionários) que opera 5+ agentes/serviços de IA em produção e gasta $5k–$50k/mês em APIs de OpenAI, Anthropic, Replicate ou similares.

**Dor específica:** Falta controle granular de gasto por agente/projeto/cliente, com risco de estouros surpresa de fatura e ausência de auditoria por agente.

**Alternativa atual:** Dashboard nativo da OpenAI/Anthropic + planilha + revisão pós-fatura. Alguns usam Helicone/LangSmith para tracking, mas sem governança financeira.

**Suposição mais arriscada:** CTOs com $10k+/mês em IA estão dispostos a **pagar em $$** por governança financeira por agente, e Helicone/LangSmith **não** resolvem suficientemente.

**Critério de morte da hipótese (após 20 entrevistas):**
- <5 reconhecerem a dor como prioritária → matar a hipótese.
- 10+ disserem "Helicone resolve isso" → matar (mercado capturado).
- 0 dispostos a pagar > $0/mês → matar (não é dor pagável).

**Em caso de morte:** pivot para Hipótese 2 (Payroll cross-border) ou Hipótese 3 (AI agents em produção genérico). Não é desistir do Aegis — é desistir desta formulação.

### Documento vivo da validação

A versão atualizada da hipótese, evidências por entrevista e cronograma de validação vivem em [validation/hypothesis-v1.md](validation/hypothesis-v1.md). Roteiro em [interviews/script.md](interviews/script.md). Log em [interviews/log.md](interviews/log.md).

---

## 5. Escopo

### O que Aegis Protocol é

- Camada de governança / control plane / API REST.
- Engine de políticas determinística para decisões de gasto.
- Trilho de execução on-chain via Stellar (asset issuance com clawback + Soroban audit + SEP-7 invoicing + Path Payments).
- SDK TypeScript para qualquer agente que fale HTTP.
- Dashboard web para administração e aprovações humanas.

### O que Aegis Protocol **não é** (non-goals)

Estas exclusões protegem foco e narrativa. Não construir:

- Framework de agentes ou runtime de LLM.
- UX de chat / orquestração de modelos.
- ERP de procurement.
- Wallet app ou dashboard genérico de cripto.
- Mainnet / pubnet — testnet é suficiente para o programa.
- Multi-sig complexo — servidor mantém issuer authority por design.
- Abstrações especulativas antes do segundo caso de uso concreto.

### Sempre frame como
camada de governança para AI agents · economic control plane · controlled autonomy · programmable treasury on Stellar · cross-border by design.

### Nunca frame como
AI wallet app · crypto dashboard · chatbot com pagamentos.

---

## 6. Como funciona (fluxo detalhado)

1. **Empresa configura políticas** — limite por transação, vendor allow/deny list, budget mensal, action types autorizados, threshold de aprovação humana.
2. **Agente solicita gasto via API** com `Authorization: Bearer cr_...`. Agente nunca tem acesso à conta Stellar; Aegis tem.
3. **Engine avalia em milissegundos** — 10 regras top-to-bottom, primeira que casa decide:
   1. `kill_switch`
   2. `agent_disabled`
   3. `action_type_not_allowed`
   4. `vendor_denied`
   5. `vendor_not_allowed`
   6. `per_transaction_limit_exceeded`
   7. `max_transaction_amount_exceeded`
   8. `daily_budget_exceeded`
   9. `monthly_budget_exceeded`
   10. `require_approval_above` (escala em vez de rejeitar)
   11. fall-through → `APPROVED`
4. **Decisão imediata** — `APPROVED` / `REQUIRES_APPROVAL` / `REJECTED`.
5. **Execução on-chain** — operação `Payment` (mesma moeda) ou `PathPaymentStrictReceive` (cross-currency atômico via DEX nativa) para a conta Stellar do vendor. Hash da transação linkável no [Stellar Expert](https://stellar.expert).
6. **Recibo on-chain** — contrato Soroban `aegis_audit` emite evento por decisão (`spendRequestId`, `decision`, `agentId`, `vendor`, `amount`, `timestamp`). Um contrato deployado por Company, registrado no campo `Company.auditContractId`. Eventos consultáveis via Soroban RPC.
7. **Kill switch** — quando ativado, a conta issuer da Aegis (com `AUTH_CLAWBACK_ENABLED` setada na criação do asset) executa uma operação `Clawback` que revoga os tokens da treasury congelada para uma conta de quarentena. Visível no Stellar Expert; ninguém consegue gastar os tokens sem a chave do issuer, mesmo que o DB seja comprometido.

---

## 7. Arquitetura

### Monorepo (Turborepo + pnpm workspaces)

```
apps/
  api/        Fastify REST API (composition root: src/server.ts) — :3001
  web/        Next.js 16 dashboard — :3000
packages/
  shared/         Zod schemas, enums, domain types, SettlementAdapter interface
  policy-engine/  evaluate() puro — zero I/O, determinístico, vitest
  stellar/        Asset issuance + clawback, contrato Soroban audit, SEP-7 URI, testnet funding
  sdk/            Cliente TypeScript para agentes (requestAndExecute, pay, waitForApproval)
contracts/
  aegis-audit/    Contrato Soroban (Rust) — emite eventos por decisão de política
examples/         ai-agent, simple-agent — demos de uso do SDK
prisma/           schema.prisma (10 entidades) + migrations
docker-compose.yml  postgres :5433 + Stellar Quickstart :8000 (Horizon, opcional)
```

Pacotes usam scope `@aegis/*`. Root `package.json` se chama `aegis-protocol`.

### Modelo de domínio (10 entidades)

1. **Company** — tenant; guarda `auditContractId` (contract ID Soroban) e `assetCode/assetIssuer` do asset emitido.
2. **Vendor** — recipient com conta Stellar real (separado de nomes-string em policy rules); pode ter trustline configurada para múltiplos assets para suportar Path Payments.
3. **Treasury** — conta Stellar + config de trustlines (`encryptedSecret` é server-side, **nunca serializado**).
4. **Agent** — agente registrado com `apiKeyHash` (SHA-256, indexed) e `killSwitchActive`.
5. **Policy** — regras como JSON (`rules`), validadas por Zod no boundary da API.
6. **Budget** — limites diário/mensal/per-tx em `Decimal(18, 7)`. Um budget por agente (`@unique`).
7. **SpendRequest** — entidade central; lifecycle `PENDING → APPROVED|REJECTED|REQUIRES_APPROVAL → EXECUTED|FAILED`.
8. **ApprovalRequest** — 1:1 com SpendRequest, criado só quando engine retorna `REQUIRES_APPROVAL`.
9. **User** — humano do dashboard (bcrypt, role `OWNER|ADMIN|VIEWER`).
10. **AuditLog** — imutável, indexado por `(companyId, createdAt)` e `(agentId, createdAt)`. `payload` é JSON freeform por `eventType` (inclui `txHash` e `sorobanEventId`).

### Camadas

```
[Agente HTTP] → [API Fastify] → [Policy Engine puro] → decisão
                       ↓
              [Services / Prisma]
                       ↓
              [SettlementAdapter]
                       ↓
                [@aegis/stellar]
                       ↓
              [Stellar testnet (Horizon + Soroban RPC)]
```

Conventions:
- Routes finas; lógica em `src/services/*`.
- `Treasury.encryptedSecret` é stripped na route layer antes de qualquer JSON.
- Lógica Stellar **nunca** é importada em routes — sempre via `@aegis/stellar` adapter (que implementa `SettlementAdapter`).

---

## 8. Stack tecnológica

| Camada | Escolha | Por quê |
|--------|---------|---------|
| Monorepo | Turborepo + pnpm 10 | Padrão de mercado, config mínima |
| Backend | Fastify + TypeScript strict + Zod | Baixo boilerplate, types fortes, validation no boundary |
| ORM | Prisma 6 | Schema como documentação, queries type-safe |
| Database | PostgreSQL 16 (Docker / Neon) | Concurrent writes, produção-ready |
| Frontend | Next.js 16 + React 19 + Tailwind v4 + NextAuth 5 (beta) + Turbopack | App Router, server components |
| Stellar SDK | `@stellar/stellar-sdk` | Horizon + Soroban RPC clients, transaction building, asset ops |
| Soroban | Rust + `soroban-sdk` (contrato), `@stellar/stellar-sdk` (invocação) | Smart contract para audit log on-chain |
| Invoicing | SEP-7 (`web+stellar:` URIs) | Padrão Stellar para QR/links de pagamento |
| Cross-currency | Path Payments (DEX nativa Stellar) | Liquidação atômica multi-currency sem oráculo externo |
| Policy | TypeScript puro (zero I/O) | Determinístico, testável, fast |
| Multi-chain | SettlementAdapter interface | Stellar é primary; interface deixa portas abertas |
| Deploy | Vercel (web) + Railway (API) + Neon (DB) | Hackathon-friendly |

**Importante para `apps/web/`:** Next.js 16 tem breaking changes vs. training data dos LLMs. Consultar `node_modules/next/dist/docs/` e respeitar deprecation notices antes de tocar em routing/server components/build config. Detalhes em [apps/web/AGENTS.md](apps/web/AGENTS.md).

---

## 9. Decisões de produto (ADRs)

> Cada ADR registra uma decisão. **Não revogar sem registrar uma nova ADR.** Adicione abaixo, mantendo a numeração crescente.

### ADR-001 — Stellar como rede de execução
**Decisão:** Construir a camada de execução on-chain em Stellar (testnet para o programa, pubnet pós-validação).
**Por quê:** Stellar é payment-native (toda primitiva da rede é centrada em pagamento), tem DEX integrada que viabiliza liquidação cross-currency atômica via Path Payments, taxas fixas desprezíveis e rede de Anchors para off-ramp fiat (SEP-31). Para a tese cross-border do Aegis, é a rede com melhor encaixe técnico e econômico.
**Consequência:** Lógica de execução vive em `@aegis/stellar`. Testnet é suficiente para o programa — não tocar em pubnet sem revisão de operações (custódia de issuer secret, recovery).

### ADR-002 — Asset issuance Aegis com `AUTH_CLAWBACK_ENABLED` para kill switch
**Decisão:** Aegis emite o asset usado pelas treasuries (ex.: `AGUSDC`) com as flags `AUTH_REQUIRED`, `AUTH_REVOCABLE` e `AUTH_CLAWBACK_ENABLED` setadas na conta issuer. Kill switch executa operação `Clawback` on-chain, não apenas flag em DB.
**Por quê:** Diferencial principal. Mesmo se o Postgres for comprometido, ninguém consegue gastar os tokens da treasury congelada — só quem tem `AEGIS_ISSUER_SECRET` consegue mover/clawback. É verificável no Stellar Expert.
**Consequência:** O servidor central **precisa** custodiar a issuer key. Multi-sig fica fora de escopo (ver ADR-008). Em produção, usar Circle USDC (sem clawback) significa abrir mão dessa garantia — trade-off explícito por tier (Enterprise pode usar asset Aegis-issued; Pro pode usar USDC nativo com kill switch só "freeze trustline").

### ADR-003 — Soroban como audit log on-chain (não memos)
**Decisão:** Cada decisão de política emite evento via contrato Soroban `aegis_audit` deployado por Company. Não usar transaction memos (28 bytes) ou Manage Data (limitado).
**Por quê:** Soroban events são indexados nativamente pelo Soroban RPC, queryáveis por filtro, permitem payload estruturado e são tamper-proof on-chain. Custo desprezível por evento e acoplamento direto com a primitiva de smart contracts da rede — também justifica o uso de Soroban como pilar técnico do programa.
**Consequência:** Cada Company precisa do contrato deployado (lazy, no primeiro spend request). Custo de deploy + storage do contrato é parte do onboarding. Reorgs/upgrades do contrato exigem ADR nova.

### ADR-004 — Engine de políticas pura (zero I/O)
**Decisão:** `evaluate(ctx) → result` em `@aegis/policy-engine` é função pura — sem DB, HTTP, time, ou randomness.
**Por quê:** Determinismo, testabilidade (17+ unit tests), portabilidade futura (migrar a engine para Soroban no longo prazo, removendo a dependência do servidor central). API layer é responsável por buscar daily/monthly totals e budget rows e passar como contexto.
**Consequência:** Toda nova regra exige unit test em `packages/policy-engine/src/__tests__/evaluate.test.ts`. Quebrar a pureza requer ADR.

### ADR-005 — SettlementAdapter como interface chain-agnostic
**Decisão:** Interface `SettlementAdapter` em `@aegis/shared` com `createWallet()`, `transfer()`, `freeze()`, `getBalance()`, `auditEvent()`. `@aegis/stellar` implementa.
**Por quê:** Lógica de governança não pode depender de Stellar especificamente. Engine de políticas, routes da API, services e SDK falam só com a interface. Isso permite deploy futuro em outras redes sem reescrever o core.
**Consequência:** Routes nunca importam `@aegis/stellar` direto. Testar essa regra em code review.

### ADR-006 — `Decimal(18, 7)` para todos os valores monetários
**Decisão:** Toda quantia em Stellar (USDC, EURC, ou asset Aegis-issued) no Prisma é `Decimal(18, 7)`. Nunca `Float`/`Number`.
**Por quê:** Stellar usa precisão fixa de 7 casas decimais no protocolo (1 unidade = 10⁷ stroops). Floats geram erros de arredondamento que viram drift contábil em escala.
**Consequência:** Conversão entre `Decimal` e `BigInt` (em stroops para o SDK Stellar) é centralizada em `@aegis/stellar`. PRs com `Float` para dinheiro são bloqueados.

### ADR-007 — SEP-7 como entrada de invoice de vendor
**Decisão:** `GET /vendors/:id/stellar-pay-uri` gera URI conforme [SEP-7](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md) (`web+stellar:pay?destination=...&amount=...&asset_code=...&asset_issuer=...&memo=...`). SDK `aegis.pay(uri)` parseia → vira SpendRequest governado.
**Por quê:** SEP-7 é o padrão Stellar para QR code / deep link de pagamento, suportado por wallets do ecossistema (Lobstr, Freighter, etc). Reutilizamos o mesmo fluxo de governança que rodaria para qualquer outro pedido de spend.
**Consequência:** Memo da transação carrega `spendRequestId` para reconciliação on-chain. Dashboard pode renderizar URI como QR para vendor invoicing.

### ADR-008 — Servidor central custodia issuer authority (não multi-sig)
**Decisão:** Aegis mantém `AEGIS_ISSUER_SECRET` server-side. Sem multi-sig na primeira versão.
**Por quê:** Scope do programa. Multi-sig (signer threshold no Stellar) agrega complexidade de UX e operacional sem ganho diferencial pré-validação. Issuer per-tenant é roadmap pago (Enterprise tier).
**Consequência:** Trust assumption explícita: empresas confiam que a Aegis não usará a issuer key indevidamente. Pós-programa, Enterprise tier separa issuer accounts por tenant.

### ADR-009 — PostgreSQL + Prisma para state, on-chain só para audit/execução
**Decisão:** State da governança (entidades, lifecycle, budgets) em Postgres. On-chain só guarda execução (Stellar Payment) e auditoria imutável (Soroban events).
**Por quê:** Latência e custo. Avaliar política em ms exige DB local; commit on-chain de cada estado intermediário seria caro e lento — Soroban tem custo de invocação não nulo.
**Consequência:** Cliente confia em Postgres para state corrente; on-chain é o source of truth auditável e o ponto de execução.

### ADR-010 — Hipótese V1: LLM Inference como vertical de validação
**Decisão:** Validar primeiro com CTOs gastando $5k–$50k/mês em APIs de IA (OpenAI/Anthropic).
**Por quê:** Mercado mais imediato, dor mais aguda hoje, fluxo financeiro existe, mais fácil validar em 3 semanas. Hipóteses 2 (Payroll cross-border) e 3 (AI agents genérico) ficam como pivot reservado.
**Consequência:** Roteiro de entrevista, DM templates e MVP enxuto focam nessa persona ([validation/hypothesis-v1.md](validation/hypothesis-v1.md)). MVP simplificado para validação **pode** dispensar blockchain visível ao usuário; Stellar entra como infraestrutura de execução invisível primeiro, depois explicitada conforme dor de auditoria emergir nas entrevistas.

### ADR-011 — Business Source License (BSL)
**Decisão:** Open source com BSL — uso comercial restrito por 4 anos.
**Por quê:** Permite verificação pelo avaliador do programa e pela comunidade, mas trava clones comerciais imediatos enquanto a startup tenta tração.
**Consequência:** Conferir LICENSE no repo; copy externa precisa ser explícita sobre BSL ≠ MIT/Apache.

---

## 10. Modelo de negócio

| Tier | Preço | Inclui |
|------|-------|--------|
| Free | $0 | 1 agente, policies básicas, 100 tx/mês |
| Pro | $49/mês | 10 agentes, policies avançadas, tx ilimitadas, recibos Soroban |
| Enterprise | $499/mês | Ilimitado, policies custom, SLA, treasury dedicada, **issuer account por tenant** (clawback isolado) |
| Volume fee | 0.1% | Sobre volume governado, cap $1/tx |

> **Observação:** disposição a pagar é parte da V1 a validar. Se entrevistas mostrarem teto < $49/mês ou volume fee inviável, revisar tabela em ADR nova.

---

## 11. Roadmap

### Pré-programa (concluído — chain-agnostic)
- [x] Monorepo + packages base.
- [x] Engine de políticas pura com 17 testes (`@aegis/policy-engine`).
- [x] API Fastify com auth via API key + NextAuth no dashboard.
- [x] SDK TypeScript com `requestAndExecute`, `waitForApproval`.
- [x] SettlementAdapter interface em `@aegis/shared`.

### Programa Stellar37 (NearX) — em execução
- [ ] `@aegis/stellar`: emissão de asset com `AUTH_CLAWBACK_ENABLED`, trustlines, Payment + Path Payment.
- [ ] Contrato Soroban `aegis_audit` (Rust) deployado em testnet, com função `record_decision` que emite event.
- [ ] `freezeTreasury()` via operação `Clawback` no Stellar.
- [ ] Geração de SEP-7 URIs (`GET /vendors/:id/stellar-pay-uri`) e `aegis.pay(uri)` no SDK.
- [ ] Dashboard com 5 telas: overview, agentes (kill switch toggle), aprovações, spend requests com Stellar Expert link, audit log com Soroban event link.
- [ ] Demo script `pnpm --filter @aegis/api demo` cobrindo 5 cenários (auto-approve, approval flow, blocked vendor, kill switch via clawback, SEP-7 invoice + Path Payment cross-currency).
- [ ] Pitch video + tech demo + submission no formato do programa.

### Validação (paralelo, ver [validation/hypothesis-v1.md](validation/hypothesis-v1.md))
- [ ] Semana 1 (06–12/05): 30 leads, 5 entrevistas agendadas, post #1 publicado.
- [ ] Semana 2 (13–19/05): 10 entrevistas realizadas, hipótese refinada → V1.1.
- [ ] Semana 3 (20–26/05): 10 entrevistas adicionais, design partner identificado, decisão estratégica continuar/refinar/pivotar.

### Pós-validação (condicional)
- 🟢 Hipótese validada → focar features do MVP nas dores mapeadas, design partner em uso real, **só depois** mexer em pubnet.
- 🟡 Hipótese parcial → pivot suave de persona dentro da vertical IA.
- 🔴 Hipótese morta → criar `validation/hypothesis-v2.md` com Hipótese 2 (Payroll cross-border, encaixa ainda melhor com Path Payments / Anchors) ou Hipótese 3 e reiniciar validação.

### Backlog explícito (não fazer agora)
- Multi-sig / threshold signers no Stellar.
- Pubnet (deploy mainnet do Stellar).
- Migração da policy engine para Soroban (engine on-chain — ADR-004 deixa porta aberta).
- Anchors SEP-31 (off-ramp fiat — ativar quando entrevista de Hipótese 2 confirmar dor).
- Suporte a múltiplos assets simultâneos por treasury (path payments multi-hop).

---

## 12. Métricas de sucesso

### Programa (entrega)
- Demo end-to-end roda sem erro do `pnpm install` inicial.
- 17+ testes do policy-engine verdes.
- 4 features Stellar-native verificáveis na testnet ao vivo (clawback, Soroban event, SEP-7, Path Payment).
- Deploy público acessível.

### Validação (3 semanas)
- 20+ entrevistas realizadas e logadas.
- 12+ confirmaram dor com história concreta.
- 5+ pediram acesso a demo.
- 1+ design partner topou testar MVP.
- Persona convergiu (60%+ mesmo cargo / tamanho).

### Pós-validação
- Definidas após Semana 3 baseado nos resultados (não pré-definir para evitar metric theater).

---

## 13. Status atual

**Data:** 2026-05-09.

**Construído (chain-agnostic, funcional):**
- Engine de políticas + 17 testes.
- API governança + dashboard + SDK.
- SettlementAdapter como contrato.
- Discovery framework (roteiro, DM templates, hipótese V1).

**Em implementação (Stellar):**
- `@aegis/stellar`: scaffold do package presente; implementação dos métodos do `SettlementAdapter` em curso.
- Contrato Soroban `aegis_audit` em Rust (a iniciar).
- Geração de SEP-7 URIs (a iniciar).
- Telas do dashboard adaptadas (Stellar Expert links, kill switch via clawback).

**Em validação:**
- Hipótese V1 (LLM Inference) — discovery em progresso.
- Roteiro, DM templates e log montados em `interviews/` e `validation/`.

**Bloqueios conhecidos:** nenhum técnico hard-blocking. Risco principal é tempo: Stellar adapter + contrato Soroban + dashboard + vídeos + deploy + entrevistas em paralelo.

---

## 14. Histórico de revisões

| Data | Autor | Mudança |
|------|-------|---------|
| 2026-05-09 | Otávio | v1.0 — documento criado consolidando README/SUBMISSION/ONE-PAGER/CLAUDE/hypothesis-v1. ADRs 001–011 registradas. |
| 2026-05-09 | Otávio | v1.1 — refoco completo de Solana → Stellar. Camada de execução Stellar-native: asset com `AUTH_CLAWBACK`, contrato Soroban audit, SEP-7, Path Payments. Solana fica em branch separada para outro hackathon. ADR-001/002/003/006/007/008 reescritas. |

> **Como atualizar:** ao adicionar/revogar uma ADR, mudar persona, alterar stack ou pivotar — incremente a versão (`v1.1 → v1.2` para refinos, `v1.x → v2.0` para pivot de hipótese) e descreva a mudança em uma linha aqui.

---

## 15. Referências internas

- [README.md](README.md) — pitch técnico, Quick Start.
- [SUBMISSION.md](SUBMISSION.md) — checklist de submissão, deploy, talking points.
- [ONE-PAGER.md](ONE-PAGER.md) — pitch executivo em PT-BR, narrativa Stellar.
- [CLAUDE.md](CLAUDE.md) — regras de engenharia para agentes Claude Code.
- [validation/hypothesis-v1.md](validation/hypothesis-v1.md) — hipótese de mercado em validação (documento vivo).
- [interviews/script.md](interviews/script.md) — roteiro de entrevista de descoberta.
- [interviews/dm-template.md](interviews/dm-template.md) — templates de outreach.
- [interviews/log.md](interviews/log.md) — log das entrevistas realizadas.
- [apps/web/AGENTS.md](apps/web/AGENTS.md) — regras específicas para Next.js 16.

### Referências externas (Stellar)

- [SEP-7 — URI Scheme](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md) — padrão de invoicing.
- [SEP-31 — Cross-Border Payments](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0031.md) — anchors fiat (roadmap).
- [Soroban Docs](https://developers.stellar.org/docs/build/smart-contracts) — smart contract platform.
- [Asset Authorization Flags](https://developers.stellar.org/docs/tokens/control-asset-access) — `AUTH_CLAWBACK_ENABLED` e relacionados.
- [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet) — block explorer.
