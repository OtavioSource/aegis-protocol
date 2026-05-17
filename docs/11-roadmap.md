# 11 — Roadmap

> Plano de evolução do Aegis Protocol em 4 marcos: MVP Testnet → Hardening → Mainnet Pilot → Scale.

---

## 1. Visão geral em uma linha por marco

| Marco | Foco | Saída | Duração estimada |
|-------|------|-------|------------------|
| **Marco 1 — MVP Testnet** | Validar produto e arquitetura em testnet | Demo end-to-end + design partners testando | ~8-10 semanas focadas |
| **Marco 2 — Hardening + Stretch** | Production-readiness operacional | KMS, multisig, observabilidade, kill switch on-chain | ~6-8 semanas |
| **Marco 3 — Mainnet Pilot** | Primeiros valores reais com 2-3 clientes design partners | Mainnet com Circle USDC + Anclap BRL | ~6 semanas (incluindo auditoria) |
| **Marco 4 — Scale** | Atingir 50+ Companies, expansão de capabilities | Multi-anchor, mobile push, billing model | aberto |

---

## 2. Marco 1 — MVP Testnet

### 2.1 Objetivo de negócio
Validar que o produto resolve uma dor real e arquitetura suporta. **Saída de sucesso:** 3 design partners (CTOs Camila / founders Marcos) usando regularmente e dando feedback acionável.

### 2.2 Escopo funcional (vide PRD §3)
- RF1-RF10 completos.
- Stretch goals NÃO incluídos.

### 2.3 Iterações detalhadas

| # | Escopo | Critério de aceite | Estimativa |
|---|--------|-------------------|------------|
| 1 | **Documentação + scaffolding** | `pnpm install` OK; docs revisadas | 3-5 dias |
| 2 | Domain types + Policy Engine puro | `pnpm test packages/policy-engine` verde com ≥15 casos; cobertura >90% | 3 dias |
| 3 | Prisma schema + migration + seed | `pnpm prisma migrate dev`; seed cria Company demo + Policy default + Agent | 2 dias |
| 4 | API REST CRUD (sem on-chain) | Bruno/Postman collection roda CRUD completo para todas entidades | 5 dias |
| 5 | `@aegis/stellar`: treasury setup + sponsored vendor + trustline USDC | Script standalone cria vendor com 0 XLM, abre trustline USDC, visível no Stellar Expert | 4 dias |
| 6 | Payment USDC end-to-end (API ↔ Stellar) | `POST /spend-requests` → engine → Payment USDC real em testnet | 3 dias |
| 7 | `@aegis/sdk` TypeScript | `examples/simple-agent` chama `pay()` e recebe TxHash | 2 dias |
| 8 | **SEP-10 + SEP-24 deposit** | Dashboard inicia deposit no test-anchor → USDC creditado na treasury | 5 dias |
| 9 | **SEP-24 withdraw** | Dashboard inicia withdraw → USDC sai da treasury → anchor confirma | 3 dias |
| 10 | Dashboard Next.js completo | Admin opera todas funcionalidades (policies, agents, vendors, approvals, treasury, fiat) | 7 dias |
| 11 | Contrato Soroban `aegis_audit` + deploy | Evento emitido após cada decisão; consultável via `soroban events` | 4 dias |
| 12 | HTTP 402 demo: vendor mock + ai-agent | Demo Claude tool_use: vendor mock retorna 402 → Aegis paga → vendor libera recurso | 3 dias |
| 13 | Hardening MVP: observabilidade, rate limit, error tracking | Logs estruturados, métricas Prometheus, Sentry básico | 4 dias |

**Total: ~50-55 dias úteis (~10-11 semanas calendário com folga).**

### 2.4 Critérios de aceite globais
Os 7 critérios definidos em `docs/01-requirements.md §7`.

### 2.5 Stretch goals (S1, S2 — só se sobrar tempo)

| Stretch | Escopo | Estimativa |
|---------|--------|------------|
| **S1 — Kill Switch via Clawback** | Asset Aegis-issued (`aUSD`) com AUTH_CLAWBACK_ENABLED; treasury holda USDC + aUSD paralelo; swap DEX; Clawback funcional; UI no dashboard | ~10 dias |
| **S2 — Multi-anchor support** | Schema do anchor no DB; plugin pattern para SEP-24 clients; preparação para Circle/Anclap | ~5 dias |
| **S3 — Webhooks** | Company configura webhook URL; HMAC signed events | ~3 dias |
| **S4 — Approval delegado** | Regras de aprovação multi-admin (2-de-N) | ~5 dias |

### 2.6 Definição de "MVP done"
- Todos os 7 critérios em §7 do PRD verdes.
- 3 design partners onboarded e fazendo spend requests reais (>50 cada nas 2 primeiras semanas após onboarding).
- Documentação completa e atualizada.
- README quickstart permite onboarding de novo dev em <30min.

---

## 3. Marco 2 — Hardening + Stretch

### 3.1 Objetivo de negócio
**Preparar para Mainnet** — passar de "demo bonito em testnet" para "infra que pode aguentar valor real e clientes pagantes sem catástrofes operacionais".

### 3.2 Escopo

#### Custódia e segurança
- Migrar treasury secret para **AWS KMS** (signing remoto via KMS API).
- Implementar **multisig 2-de-3** na treasury (Aegis API + admin humano + key recovery offline).
- Rotação automática de API keys de Agent (90 dias default, configurável).
- 2FA obrigatório para Users OWNER/ADMIN (TOTP via NextAuth).
- Migrar custódia de vendor secrets (Modo AEGIS) para KMS individual.

#### Observabilidade
- Sentry para error tracking com alerts críticos.
- Datadog ou Grafana Cloud para métricas e tracing OpenTelemetry.
- SLOs definidos: 99.5% availability, p95 latency <200ms (API), <5s (Stellar tx).
- Dashboards públicos status.aegis-protocol.dev.

#### Resiliência
- Cloudflare em frente da API (DDoS protection).
- Backup automatizado do DB (Neon point-in-time recovery + dump diário S3).
- Disaster recovery plan testado (game day quarterly).
- Failover: standby region (futuro).

#### Operação
- Incident response runbook escrito.
- On-call rotation (mesmo que seja 1 pessoa).
- Postmortem template para incidentes.

#### Kill Switch on-chain (Stretch S1 movido para core)
- Implementar asset `aUSD` Aegis-issued com AUTH_CLAWBACK_ENABLED.
- Treasury holda USDC (operacional) + aUSD (governance).
- UI no dashboard com dupla confirmação.
- Documentar custo e implicações de liquidez.

### 3.3 Estimativa
~6-8 semanas focadas.

### 3.4 Saída
- Aegis pode processar valor real sem fingir "tem segurança que não tem".
- Documentação de operações pronta.
- Compliance básica: termos de uso, política de privacidade, DPA.

---

## 4. Marco 3 — Mainnet Pilot

### 4.1 Objetivo de negócio
**Processar primeiros pagamentos com valor real**, com 2-3 design partners pagando pelo serviço (mesmo que cobrança pequena).

### 4.2 Escopo

#### Mainnet readiness
- Deploy completo em mainnet (Horizon, Soroban RPC, anchors reais).
- Asset USDC oficial Circle (mainnet issuer `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`).
- Treasury mainnet com multisig e KMS (do Marco 2).
- Sponsoring: cálculo de custo operacional em XLM real ($X por vendor onboarded).

#### Anchors integrados
- **Circle Account API** (USDC para USD via banco US).
- **Anclap** (USDC para BRL para clientes brasileiros).
- (Opcional) **MoneyGram Access** (cash global).
- UI no dashboard: Company escolhe anchor por currency.

#### Auditoria
- Auditoria de segurança externa por firma reputada (~$10-30k).
- Penetration test.
- Correção de findings antes do lançamento.

#### Compliance
- SOC2 Type 1 readiness (não certificação ainda; só processos).
- Política de privacidade, termos de uso publicados.
- DPA template para clientes empresariais.

#### Business model embrionário
- Pricing público: % de transacionado + fixo mensal por Company.
- Stripe ou similar para cobrança fiat.
- Self-service onboarding com plano free (até $X de volume/mês).

### 4.3 Estimativa
~6 semanas (auditoria pode ser paralela ao desenvolvimento).

### 4.4 Saída
- 2-3 clientes pagando mensalmente.
- $X em volume transacionado/mês (target: $50k+).
- Zero incidentes de segurança em 60 dias.

---

## 5. Marco 4 — Scale

### 5.1 Objetivo de negócio
**Crescer base de clientes para 50+** Companies, atingir $1M+ de volume mensal, validar economia da operação.

### 5.2 Escopo (alta granularidade, vai refinar quando chegar)

- **Multi-tenancy avançada:** opção de Company com account/subaccount Stellar isolada para enterprise.
- **Mobile push notifications:** app companion para admin aprovar spends de qualquer lugar.
- **Webhooks robustos** com retry e dead letter queue.
- **Integrações:** Slack/Teams notifications, PagerDuty, Linear/Jira para incidentes.
- **Analytics:** dashboard cross-Company com benchmarks (anonimizado), cost-per-action por categoria.
- **Approval workflows complexos:** 2-de-N, regras por valor, por vendor, por horário.
- **Templates de Policy:** library de policies prontas por industry vertical (e-commerce, SaaS, AI startups).
- **Billing maduro:** usage-based pricing, prepaid credits, invoicing.
- **Multi-region:** deploy em EU + LATAM para latência/compliance.
- **Aegis Proxy Mode (importante):** proxy HTTP/HTTPS para APIs LLM tradicionais (OpenAI, Anthropic, Google, etc.) que **não falam HTTP 402**. Cliente aponta SDK para `proxy.aegis.dev/<provider>` em vez do endpoint original. Aegis estima custo (tokens × preço), aplica policy do agente, encaminha para o provider com API key gerenciada (sob contrato Aegis ↔ provider), cobra cliente em USDC ou fiat depois. Cobre a lacuna entre vendors HTTP 402 e vendors legacy — Aegis vira único ponto de governança para todo gasto do agente, independente do canal. Adiciona ~6-12 meses de escopo (contratos com providers, compliance, billing maduro) — por isso fica em Marco 4, não MVP. Detalhes da motivação em [Vision §2.4](00-vision.md#24-escopo-de-controle-o-que-aegis-cobre-e-o-que-n%C3%A3o-cobre-no-mvp).
- **More chains (talvez):** Solana, Base, conforme demanda.

---

## 6. Roadmap visual (Gantt simplificado)

```
                  Q3 2026  Q4 2026  Q1 2027  Q2 2027  Q3 2027+
Marco 1 — MVP    ████████
Marco 2 — Hard.           ███████
Marco 3 — Pilot                    ██████
Marco 4 — Scale                            ██████████ ...
```

(Datas são estimativas iniciais; revisar quando Marco 1 estiver próximo de concluir.)

---

## 7. KPIs de saúde do produto por marco

| KPI | Marco 1 | Marco 2 | Marco 3 | Marco 4 |
|-----|---------|---------|---------|---------|
| Companies ativas | 3 | 3 | 5-10 | 50+ |
| Volume USDC/mês | $0 (testnet) | $0 (testnet+) | $50k+ | $1M+ |
| Spend requests/dia | 50+ | 200+ | 1k+ | 10k+ |
| Latência API p95 | <200ms | <200ms | <200ms | <150ms |
| Disponibilidade | best-effort | 99% | 99.5% | 99.9% |
| Incidentes críticos | aceito (testnet) | 0 em 30d antes Mainnet | 0 em 60d | <2/ano |
| NPS design partners | N/A | >40 | >50 | >60 |

---

## 8. Riscos macro do roadmap

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Test-anchor SEP-24 muda ou descontinuou | Baixa | Alto | Acompanhar Stellar Discord, fallback mock anchor |
| Soroban Mainnet ainda imaturo em Q1/2027 | Média | Médio | Soroban Mainnet já está vivo em 2026; risco baixando |
| Circle muda termos de uso da Account API | Baixa | Alto | Backup com Anclap; multi-anchor desde Marco 3 |
| Regulatório (BR/EU) classifica Aegis como PSP | Média | Alto | Estrutura legal antes de Marco 3; consultar advogado especialista |
| Demanda menor que esperada (TAM superestimado) | Média | Crítico | Customer discovery contínua; ajustar narrativa para verticals onde demanda é clara (AI startups primeiro) |
| Concorrente entra (Stripe lança "Issuing for Agents") | Média | Alto | Diferencial: audit on-chain + cripto-native; especializar |
| Hot wallet comprometida durante MVP testnet | Baixa | Médio | Aceito em testnet; alerta + procedure |
| Mainnet — hot wallet comprometida com valor real | Baixa (com Marco 2 done) | Catastrófico | KMS + multisig + monitoria 24/7 + kill switch via Clawback |

---

## 9. Como este roadmap se conecta com o que está documentado

| Documento | Marcos onde é relevante |
|-----------|------------------------|
| `00-vision.md` | Sempre — tese de longo prazo guia priorização |
| `01-requirements.md` §3 (RFs MVP) | Marco 1 |
| `01-requirements.md` §5 (Stretch S1-S4) | Marco 2 |
| `04-stellar-asset-design.md` §7 (Stretch aUSD) | Marco 2 |
| `06-fiat-onramp-sep24.md` §11 (Mainnet anchors) | Marco 3 |
| `10-security.md` §7 (hardening plan) | Marco 2-3 |

---

## 10. Revisão deste roadmap

Este documento é revisado:
- **Ao final de cada marco** (postmortem + ajuste de próximos marcos).
- **Quando há mudança de strategy** (pivô, novo cliente importante, novo concorrente).
- **A cada 3 meses** mesmo sem mudança (sanity check).

Última revisão: **2026-05-17** (criação inicial).
