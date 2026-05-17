# 01 — Requisitos (PRD)

> Product Requirements Document do MVP do Aegis Protocol. Enxuto e acionável.

**Status:** Draft v1 · **Network alvo:** Stellar Testnet · **Marco:** 1 (MVP)

---

## 1. Resumo executivo

O MVP do Aegis Protocol entrega um gateway de pagamento governado para agentes de IA, operando em Stellar Testnet, com:

- API REST + SDK TypeScript para agentes solicitarem gastos.
- Engine de políticas determinística (<100ms) decidindo APPROVED / REQUIRES_APPROVAL / REJECTED.
- Execução de pagamento USDC on-chain real via testnet (asset USDC do anchor SEP-24).
- Recibo on-chain via contrato Soroban global emitindo evento por decisão.
- Dashboard web para administração (companies, agents, policies, vendors, approvals, fiat ramp).
- Onboarding zero-fricção de vendors via Sponsored Reserves (vendor sem XLM).
- Fiat in/out via SEP-24 (testnet: `testanchor.stellar.org`).

Não faz parte do MVP: kill switch via Clawback (stretch S1), mainnet, multi-anchor, KMS, multi-chain real.

---

## 2. Personas e atores

| Ator | Papel | Acesso |
|------|-------|--------|
| **(CTO Company)** | Admin: cadastra agentes, políticas, vendors; aprova requests escaladas; opera fiat ramp | Dashboard web (NextAuth) |
| **Agent IA (programático)** | Solicita pagamento via API com `Bearer cr_...` | API REST + SDK |
| **Vendor (pessoa/empresa)** | Recebe USDC na conta Stellar sponsoreada pela Aegis | Não acessa nada; apenas recebe |
| **Aegis Operator (interno)** | Aegis SRE: monitora treasury, atende suporte | (fora do escopo MVP — admin via SQL direto) |

---

## 3. Requisitos Funcionais

### RF1 — Receber spend request via API
- `POST /spend-requests` aceita payload com `vendorId`, `amount`, `asset`, `actionType`, `reason`, `metadata`.
- Auth obrigatória via header `Authorization: Bearer cr_<agentApiKey>`.
- Header `Idempotency-Key` obrigatório (evita pagamento duplicado em retry).
- Resposta síncrona com decisão imediata para fluxo APPROVED/REJECTED; resposta com `status: PENDING_APPROVAL` se cair em REQUIRES_APPROVAL.

### RF2 — Avaliar política
- Engine pura (zero I/O) avalia request contra `Policy` ativa do agente.
- Regras suportadas no MVP:
  - `maxPerTransaction` (limite por tx)
  - `monthlyBudget` (saldo restante no mês)
  - `vendorAllowList` (whitelist explícita)
  - `vendorDenyList` (blacklist explícita)
  - `actionTypes` (lista de tipos de ação autorizadas)
  - `humanApprovalThreshold` (valor acima do qual exige aprovação humana)
- Ordem de avaliação determinística e documentada (ver `docs/09-policy-dsl.md`).
- Latência p95 < 50ms, p99 < 100ms.

### RF3 — Tomar decisão e persistir
- Três estados possíveis: `APPROVED`, `REQUIRES_APPROVAL`, `REJECTED`.
- Cada decisão persiste em `SpendRequest` com `decision`, `decisionReason`, `evaluatedAt`, `policySnapshot` (copy da policy no momento da decisão para auditoria histórica).
- Transições de estado válidas:
  - `CREATED` → `APPROVED` → `EXECUTED` (sucesso) ou `EXECUTION_FAILED`
  - `CREATED` → `REQUIRES_APPROVAL` → `APPROVED_BY_HUMAN` → `EXECUTED` ou `REJECTED_BY_HUMAN`
  - `CREATED` → `REJECTED`

### RF4 — Executar pagamento USDC on-chain
- Após `APPROVED` (engine ou humano), Aegis monta e submete transação Stellar:
  - Source: conta master da treasury Aegis.
  - Operation: `Payment` com asset USDC do anchor.
  - Destination: `vendorWallet.publicKey`.
  - `Memo.hash` = `sha256(spendRequestId)` (backup off-chain do recibo).
  - Aegis paga a fee da transação.
- Hash da transação fica registrado em `SpendRequest.txHash`, linkável no Stellar Expert.
- Se pagamento falhar (vendor sem trustline, saldo insuficiente, etc.), `SpendRequest.status = EXECUTION_FAILED` com erro detalhado.

### RF5 — Emitir recibo on-chain via Soroban
- Contrato Soroban global `aegis_audit` é invocado após cada decisão (incluindo REJECTED).
- Função: `record_decision(companyId, spendRequestId, decision, agentId, vendorId, amount, asset, timestamp)`.
- Emite evento com topics `["aegis", "decision", companyId]` + data payload.
- Invocação assíncrona (não bloqueia resposta da API) mas com retry garantido.
- Consultável via Soroban RPC `getEvents` filtrando por topic.

### RF6 — Dashboard web para administração
Páginas mínimas do MVP:
- **Login** (NextAuth, credentials ou OAuth)
- **Dashboard home** — KPIs: balance USDC, requests hoje, pending approvals
- **Companies** (multi-tenant futuro; MVP = 1 company por user)
- **Agents** — CRUD, rotação de API key, ver requests do agente
- **Policies** — CRUD, atribuir a agente, visualizar JSON da policy
- **Vendors** — CRUD com onboarding sponsored (1 botão cria account Stellar + trustline)
- **Spend Requests** — lista filtrada, detalhes, link Stellar Expert
- **Approvals** — fila de pending approvals com botão Approve/Reject
- **Treasury** — balance USDC, XLM operacional, histórico de tx
- **Fiat Ramp** — botões "Deposit" e "Withdraw" abrindo modal SEP-24

### RF7 — Aprovação humana
- SpendRequest em `REQUIRES_APPROVAL` aparece na fila do dashboard.
- Admin clica Approve → status vira `APPROVED_BY_HUMAN`, dispara RF4.
- Admin clica Reject com motivo → status vira `REJECTED_BY_HUMAN`, dispara RF5.
- Timeout configurável (default: 24h) — após timeout vira `EXPIRED` automaticamente.
- Notificação por email ou webhook ao admin quando entra na fila (MVP: log + email simples; webhook é stretch).

### RF8 — Fiat on-ramp (SEP-24 deposit)
- API `POST /fiat/deposits` autentica contra o anchor via SEP-10, inicia SEP-24 deposit interactive.
- Resposta inclui `url` do modal interativo do anchor (KYC + dados bancários).
- Após anchor confirmar, USDC é creditado na conta da treasury Aegis automaticamente.
- Dashboard mostra status: `INITIATED` → `PROCESSING` → `COMPLETED` ou `FAILED`.

### RF9 — Fiat off-ramp (SEP-24 withdraw)
- API `POST /fiat/withdrawals` autentica via SEP-10, inicia SEP-24 withdraw interactive.
- Admin completa dados bancários no modal interativo do anchor.
- Aegis envia USDC da treasury para a conta do anchor com Memo apropriado.
- Anchor processa e credita fiat na conta bancária da Company.
- Dashboard mostra status como em RF8.

### RF10 — Onboarding zero-fricção de vendor (Sponsored)
- API `POST /vendors` aceita `name`, `publicKey` (opcional — Aegis pode gerar), `preferredAsset` (default `"USDC"`; aceita `"EURC"`, `"BRL"`, etc.), `metadata`.
- Aegis monta transação atomic com:
  - `BeginSponsoringFutureReserves(vendor)`
  - `CreateAccount(vendor, startingBalance: 0)`
  - `ChangeTrust(vendor, <preferredAsset>)` (sponsored — asset escolhido pelo vendor, não fixo em USDC)
  - `EndSponsoringFutureReserves(vendor)`
- Vendor pode receber em seu asset preferido (USDC, EURC, BRL, etc.) em segundos, sem ter XLM, sem ter feito qualquer ação na Stellar.
- Aegis treasury fica com ~1 XLM travado em reserves enquanto a relação dura (custo operacional documentado).
- Endpoint `DELETE /vendors/:id` opcional: revoga sponsorship e recupera reserves (vendor wallet precisa ter saldo zerado no asset antes).

### RF11 — Pagamento cross-asset via Path Payment Strict Receive
- Treasury Aegis holda **apenas USDC** como reserva operacional.
- Quando vendor tem `preferredAsset = "USDC"`: operação Stellar `Payment` simples (USDC → USDC).
- Quando vendor tem `preferredAsset ≠ "USDC"` (ex: `"EURC"`, `"BRL"`, `"ARS"`): operação `PathPaymentStrictReceive`:
  - `sendAsset = USDC`
  - `sendMax = <valor USDC + slippage tolerance>`
  - `destAsset = <preferredAsset resolvido em Asset(code, issuer)>`
  - `destAmount = <valor exato em asset destino>`
  - `path = <melhor caminho calculado via Stellar Horizon /paths/strict-receive>`
  - Conversão atomic via DEX nativa Stellar — vendor recebe **exatamente** o valor solicitado no asset escolhido.
- Pré-requisito operacional: liquidez no order book Stellar para o par `USDC ↔ preferredAsset`. Em mainnet, anchors como Anclap (BRL/ARS/EURC/USDC), Circle (USDC/EURC) e Tempo (EURC) mantêm pares ativos.
- Slippage tolerance configurável por Company via `Policy.rules.pathPaymentSlippage` (default `0.01` = 1%). Se mercado não tiver liquidez suficiente, request falha com erro claro (`PATH_NOT_FOUND` ou `EXCEEDS_SLIPPAGE`) e admin pode tentar de novo ou ajustar slippage.
- Para testnet: validar liquidez do `testanchor.stellar.org`; se limitada, Aegis pode atuar como market maker mínimo temporariamente para demos passarem.
- Documentado em detalhe em [`docs/04-stellar-asset-design.md §6`](04-stellar-asset-design.md#6-multi-asset-vendor--path-payment-strict-receive-ativo-no-mvp) e [`docs/adr/0011-vendor-multi-asset-path-payment.md`](adr/0011-vendor-multi-asset-path-payment.md).

---

## 4. Requisitos Não-Funcionais

### RNF1 — Performance
- Decisão de política: p95 < 50ms, p99 < 100ms (engine pura, in-process).
- API response (decisão + persist, sem on-chain): p95 < 200ms.
- Submit Stellar tx → confirmação: p95 < 5s (limitado pelo testnet, ~5s por ledger).

### RNF2 — Idempotência
- `POST /spend-requests` exige header `Idempotency-Key` (UUID).
- Mesma key + mesmo body retorna a SpendRequest original (sem duplicar pagamento).
- Mesma key + body diferente → HTTP 409 Conflict.
- Idempotency keys persistem por 7 dias.

### RNF3 — Observabilidade
- Logs estruturados (JSON) com `requestId`, `companyId`, `agentId`, `spendRequestId`.
- Métricas mínimas exportadas (formato Prometheus ou OTel):
  - `aegis_spend_requests_total{company,decision}`
  - `aegis_policy_evaluation_duration_seconds`
  - `aegis_stellar_tx_submitted_total{result}`
  - `aegis_treasury_balance_usdc`
- Health check `GET /healthz` (DB + Horizon reachability).

### RNF4 — Segurança
- Secret keys (treasury, JWT) em env vars / Railway secrets (MVP).
- API keys de agente armazenadas como hash (bcrypt/argon2) no DB.
- Rate limit por agentId (default 10 req/s, configurável).
- HTTPS obrigatório (Railway TLS termination).
- Threat model documentado em `docs/10-security.md`.

### RNF5 — Disponibilidade
- MVP: best-effort (sem SLA formal).
- Dependências externas: Horizon (Stellar), Soroban RPC, SEP-24 anchor — degradação graceful (queue de retry para Soroban events; fallback para "estimated balance" se Horizon down).

### RNF6 — Multi-tenancy
- Toda entidade tem `companyId`; queries sempre filtram por companyId derivado da sessão (dashboard) ou da API key (agente).
- MVP: 1 company por user (sem invite system).
- Row-level isolation no Prisma via middleware.

### RNF7 — Auditabilidade
- Toda decisão tem evento Soroban correspondente (eventual consistency, retry garantido).
- Audit log local (`AuditEvent` table) é fonte de verdade primária; evento Soroban é prova externa imutável.
- Export CSV de audit log via dashboard (admin).

---

## 5. Stretch Goals (só se Marco 1 ficar pronto antes do prazo)

### S1 — Kill switch via Clawback
- Asset Aegis-issued separado (`aUSD`) com `AUTH_CLAWBACK_ENABLED` no momento da criação.
- Treasury holda paralelamente USDC (operacional, via anchor) + `aUSD` (governance).
- Quando kill switch é disparado pelo admin, Aegis emite operação `Clawback(aUSD, treasuryAccount, quarantineAccount)`.
- UI: botão "Activate Kill Switch" no dashboard com confirmação dupla.
- Visível no Stellar Expert.

### S2 — Multi-anchor
- Permitir Company escolher entre anchors (testnet: somente test-anchor; preparação para mainnet com Circle, Anclap).
- Schema do anchor no DB; plugin pattern para SEP-24 clients.

### S3 — Webhook notifications
- Company configura webhook URL para receber eventos: `spend_request.requires_approval`, `spend_request.executed`, `fiat.deposit.completed`, etc.
- HMAC signature header.

### S4 — Approval delegado
- Suporte a múltiplos admins por Company com regras de aprovação (qualquer um, 2-de-N, etc.).

---

## 6. Fora de escopo (MVP)

| Item | Por quê fora |
|------|--------------|
| Mainnet | MVP é testnet; mainnet vem no Marco 3 |
| Multi-chain (Solana, Base, etc.) | Stellar-only no MVP; adapter preparado mas não implementado |
| KMS / HSM para custódia | Hot wallet suficiente para testnet; KMS no Marco 2 |
| Multisig na treasury | Mesmo motivo do KMS |
| Fiat ramp em múltiplas moedas (BRL/EURC/etc.) | MVP só faz fiat ramp em USDC via test-anchor. Mainnet com Circle (USD) + Anclap (BRL/EURC) vem no Marco 3. **Vendor já recebe em BRL/EURC** no MVP via Path Payment Strict Receive (RF11) — só não há ramp fiat→BRL ainda |
| Aegis Proxy Mode (governance sobre APIs LLM tradicionais OpenAI/Anthropic/etc) | Não cobre billing-via-cartão no MVP — vide [Vision §2.4 Escopo de controle](../docs/00-vision.md#24-escopo-de-controle-o-que-aegis-cobre-e-o-que-n%C3%A3o-cobre-no-mvp). Marco 4 planejado |
| Mobile app | Dashboard web suficiente |
| Cartões físicos / virtuais | Não é o modelo Aegis; pagamento direto on-chain |
| Pricing / billing model | Estratégia de negócio, definida depois de MVP |
| Marketplace de vendors | Out of scope produto |
| Anchor Aegis-próprio | Out of scope completamente; sempre usar anchors externos |
| KYC/AML da Company/vendor | Delegado ao anchor (SEP-24) |

---

## 7. Critérios de aceite globais do Marco 1

O MVP está concluído quando:

1. ✅ **Demo end-to-end funciona em testnet**: Camila (admin) cadastra Company → cria policy → cadastra agent → cadastra vendor (sponsored, zero XLM no vendor) → deposita fiat via SEP-24 → agente faz spend request via SDK → policy aprova → USDC sai da treasury → vendor recebe → evento Soroban consultável → Camila vê na dashboard.
2. ✅ **Demo HTTP 402 funciona**: vendor mock retorna 402 → agente Claude chama Aegis SDK → Aegis paga → agente reapresenta prova ao vendor → vendor libera o recurso.
3. ✅ **Approval flow funciona**: spend request acima do threshold → fica REQUIRES_APPROVAL → Camila aprova no dashboard → executa → evento Soroban.
4. ✅ **Withdraw fiat funciona**: dashboard inicia withdraw via SEP-24 → USDC sai da treasury → anchor confirma → status COMPLETED.
5. ✅ **Audit verificável**: 100 spend requests aleatórias → todas têm evento Soroban consultável via RPC.
6. ✅ **Testes**: cobertura policy-engine > 90%; testes de integração da API com Stellar testnet passando em CI.
7. ✅ **Documentação completa**: todos os arquivos em `docs/` revisados; quickstart no README permite onboardar novo dev em <30min.
8. ✅ **Demo multi-asset funciona**: vendor cadastrado com `preferredAsset = "EURC"` (ou BRL se liquidez testnet permitir) recebe pagamento via `PathPaymentStrictReceive`; treasury despende USDC, vendor recebe EURC com path visível no Stellar Expert. Se test-anchor não tiver liquidez, Aegis age como market maker mínimo (documentado como "demo helper", não produção).

---

## 8. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Test-anchor SEP-24 instável | Média | Alto | Mock anchor local para CI; usar live test-anchor só para demos |
| Latência Soroban RPC alta | Média | Médio | Eventos emitidos async com retry queue |
| Treasury fica sem XLM (sponsoring consome) | Baixa | Alto | Alert quando balance XLM < 100; auto-funding via Friendbot em testnet |
| Hot wallet comprometida (chave vaza) | Baixa | Crítico | Em testnet o impacto é baixo; ADR-004 detalha plano Mainnet |
| Idempotency mal-implementada → pagamento duplo | Média | Crítico | Testes específicos + lock em DB com `(idempotency_key, company_id)` unique |
| Anchor demora muito ou rejeita deposit | Média | Médio | UI mostra status claramente; retry manual disponível |
| Vendor sem trustline recebe Payment → falha | Alta sem mitigação | Médio | Onboarding sponsored cria trustline automaticamente; validação prévia antes de submeter tx |

---

## 9. Métricas para acompanhamento pós-MVP

Pra avaliar se o MVP está sendo útil quando rodar com design partners:

- **Adoção:** N companies ativas, N agents registrados, N policies criadas.
- **Volume:** spend requests/dia, USDC volume transactionado/dia.
- **Confiança:** % de spend requests aprovadas pela engine vs % escalada para humano.
- **Saúde:** P95 latency, error rate, treasury XLM balance.
- **Feedback:** NPS dos design partners, incidentes reportados, feature requests.
