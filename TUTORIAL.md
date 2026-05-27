# Aegis Protocol — Tutorial end-to-end

> Walkthrough técnico para validar tudo que existe no MVP, em ordem.
> Todos os pagamentos saem na **Stellar Testnet** (USDC do test-anchor) e
> os fluxos de fiat usam o **anchor Etherfuse** em sandbox.

---

## 1. O que foi construído

| Camada | O que faz | Como validar |
|---|---|---|
| **Policy Engine** (`@aegis/policy-engine`) | Função pura, zero-I/O, <100ms — decide `APPROVED` / `REQUIRES_APPROVAL` / `REJECTED` | `pnpm --filter @aegis/policy-engine test` (26 testes) |
| **API** (`@aegis/api`, Fastify) | REST `/v1/*` — spend-requests, approvals, vendors, policies, fiat, x402 facilitator | curl + dashboard |
| **`@aegis/stellar`** | Treasury, pagamento USDC (Payment + Path Payment), sponsoring CAP-33, SEP-10, SEP-24, Etherfuse client | já validado on-chain |
| **`@aegis/sdk`** | SDK TS para agentes (`AegisClient.pay`, `payX402`, `parsePaymentRequired`) | `pnpm --filter @aegis/sdk test` (23 testes) |
| **Dashboard** (`@aegis/web`, Next.js) | Admin: políticas, agentes, vendors, fila de aprovação humana, saldos, fiat ramp, auditoria | http://localhost:3000 |
| **Soroban audit** (`contracts/aegis-audit`) | Recibo on-chain imutável por decisão (`record_decision`) | **código pronto, contrato ainda não deployado** |
| **x402** | Vendor-mock + agente Claude tool_use + facilitator `/v1/x402/verify` | demo end-to-end, validado on-chain |

---

## 2. Pré-requisitos

- Node 22+ · pnpm 10+ · Rust + soroban-cli (opcional, p/ buildar o contrato)
- `apps/api/.env.local` configurado (Neon, treasury, Etherfuse)
- Treasury fundada em testnet (XLM via friendbot, USDC via anchor)

```bash
pnpm install
pnpm -r build
pnpm --filter @aegis/api db:generate
pnpm --filter @aegis/api db:seed   # gera uma API key fresca; salve a key exibida
```

---

## 3. Subindo os 3 serviços

| Serviço | Comando | URL |
|---|---|---|
| API | `pnpm --filter @aegis/api dev` | http://localhost:4000 |
| Dashboard | `pnpm --filter @aegis/web dev` | http://localhost:3000 |
| vendor-mock | `pnpm --filter vendor-mock start` | http://localhost:4001 |

---

## 4. Credenciais e IDs (após o seed)

```text
Dashboard:     admin@aegis-demo.com / admin123
API key:       cr_<exibida pelo db:seed>
Vendor demo:   34a36966-8090-423b-8609-a514dbdec8f3 (Iter6 Test Vendor)
Vendor wallet: GD3IP6NSPIJ7O2BSM6ZUW7NZ2DMWRP2NTNOJVF6XOHBMDWVWNXWWYBBW
Treasury:      GC2FCO5BDV4VV4GCOJL2R4PXFFSUWBIM3QPDQWTYILFCA5FJYU6PTOES
```

---

## Demo 1 — Treasury e saldos on-chain

```bash
# Via API (Aegis)
curl -s http://127.0.0.1:4000/v1/treasury/balances \
  -H "Authorization: Bearer <API_KEY>"

# Direto no Horizon (testnet)
curl -s "https://horizon-testnet.stellar.org/accounts/GC2FCO5BDV4VV4GCOJL2R4PXFFSUWBIM3QPDQWTYILFCA5FJYU6PTOES"
```

No dashboard: `/` (Visão geral) mostra os saldos da treasury.

---

## Demo 2 — Spend request happy path

Pedido de gasto pequeno (cabe abaixo do threshold de aprovação humana, $100):

```bash
IK=$(node -e 'console.log(require("crypto").randomUUID())')
curl -s -X POST http://127.0.0.1:4000/v1/spend-requests \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IK" \
  -d '{"vendorId":"34a36966-8090-423b-8609-a514dbdec8f3","amountCents":100,"asset":"USDC","actionType":"api-call","reason":"demo"}'
```

**Esperado:** `status: EXECUTED`, `decision: APPROVED`, `txHash` de 64 hex, `stellarExpertUrl`. Vendor wallet sobe +0.01 USDC; treasury cai 0.01.

---

## Demo 3 — Aprovação humana (RF7)

Pedido acima do threshold:

```bash
IK=$(node -e 'console.log(require("crypto").randomUUID())')
curl -s -X POST http://127.0.0.1:4000/v1/spend-requests \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IK" \
  -d '{"vendorId":"34a36966-8090-423b-8609-a514dbdec8f3","amountCents":15000,"asset":"USDC","actionType":"api-call","reason":"acima do threshold"}'
```

**Esperado:** HTTP 202, `status: REQUIRES_APPROVAL`. No dashboard → **Aprovações** o card aparece. Aprovar dispara `executeSpendRequestPayment` (vai falhar com `EXECUTION_FAILED` se a treasury não cobrir o valor; rejeitar é o caminho limpo para validar a decisão).

---

## Demo 4 — Fiat on-ramp (Etherfuse, BRL → USDC)

Company deposita em R$ via Pix sandbox → treasury recebe USDC.

```bash
# 1. Inicia o deposit
curl -s -X POST http://127.0.0.1:4000/v1/fiat/deposits \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"etherfuse","sourceAsset":"BRL","sourceAmountCents":3000,"asset":"USDC","targetAssetIdentifier":"USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"}'
# → resposta contém `id` (FiatDeposit) e `orderId` (Etherfuse)

# 2. Sandbox-only: simula o Pix recebido
curl -s -X POST http://127.0.0.1:4000/v1/fiat/deposits/<id>/simulate \
  -H "Authorization: Bearer <API_KEY>"

# 3. Atualiza status
curl -s -X POST http://127.0.0.1:4000/v1/fiat/deposits/<id>/refresh \
  -H "Authorization: Bearer <API_KEY>"
```

**Esperado:** `PENDING_USER_TRANSFER → PROCESSING → COMPLETED`. Treasury sobe USDC on-chain. Audit event `FIAT_DEPOSITED` registrado.

Dashboard → **Fiat ramp** mostra todo o histórico.

---

## Demo 5 — Fiat off-ramp (Etherfuse, USDC → BRL)

Treasury queima USDC on-chain → Etherfuse paga BRL via Pix na conta.

```bash
curl -s -X POST http://127.0.0.1:4000/v1/fiat/withdrawals \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"asset":"USDC","assetIdentifier":"USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5","amountCents":125,"targetFiat":"BRL"}'
```

**Esperado:** `status: PROCESSING` com `burnTxHash` real (a treasury assinou e submeteu a `burnTransaction` montada pelo Etherfuse). No sandbox o status fica em `funded` (limitação documentada do Etherfuse sandbox; o burn on-chain é real).

---

## Demo 6 — x402 end-to-end com agente Claude

Configurar `examples/claude-agent-402/.env.local`:

```text
ANTHROPIC_API_KEY=sk-ant-...
AEGIS_API_KEY=cr_<do seed>
AEGIS_API_URL=http://localhost:4000
AEGIS_VENDOR_ID=34a36966-8090-423b-8609-a514dbdec8f3
VENDOR_MOCK_URL=http://localhost:4001
```

E `examples/vendor-mock/.env.local`:

```text
VENDOR_MOCK_PORT=4001
VENDOR_MOCK_RESOURCE_PRICE_CENTS=5
VENDOR_WALLET_PUBLIC_KEY=GD3IP6NSPIJ7O2BSM6ZUW7NZ2DMWRP2NTNOJVF6XOHBMDWVWNXWWYBBW
AEGIS_FACILITATOR_URL=http://localhost:4000
VENDOR_MOCK_ASSET_IDENTIFIER=USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
```

Rodar:

```bash
pnpm --filter claude-agent-402 start
```

**Esperado (4 iterações do Claude tool_use):**
1. `call_vendor_api` → vendor 402 + `X-PAYMENT-REQUIRED` (`accepts:[{scheme:'exact', network:'stellar:testnet', amount:'0.05', payTo, asset}]`).
2. `pay_with_aegis` → `status:EXECUTED`, `txHash`, `paymentSignature`.
3. `call_vendor_api(payment_signature)` → **HTTP 200 + market data**.
4. `end_turn` — relatório final.

A rota `/v1/x402/verify` tem **dois caminhos**:
- **Aegis "pay-first"** — quando o payload carrega um `txHash` 64-hex, verifica direto no Horizon (asset, valor, destino batem com requirements). É o caminho usado pelo Aegis.
- **Canônico `@x402/stellar`** — fallback para clientes que entregam a tx ainda não submetida no `X-PAYMENT` (facilitator faz settle).

---

## Auditoria

Dashboard → **Auditoria**. Eventos: `PAYMENT_EXECUTED`, `FIAT_DEPOSITED`, `FIAT_WITHDRAWN`, `APPROVAL_GRANTED`, `APPROVAL_DENIED`. Hoje só no Postgres; **quando o contrato Soroban for deployado**, cada decisão também emite evento on-chain (`record_decision`).

---

## O que ainda não está pronto

1. **Contrato Soroban deployado** — código pronto (`contracts/aegis-audit`); falta `stellar contract deploy` + setar `AUDIT_CONTRACT_ID` no `.env.local`. O emit é fire-and-forget, então não bloqueia o pagamento.
2. **SEP-31 — payout de vendor em fiat (Pix/conta)** — próximo grande passo para cobrir vendors que só recebem fiat. Abre o modelo de negócio.
3. **Hardening** — logs estruturados, métricas, rate limit fino, error tracking.
4. **Validação visual do dashboard** — smoke test automatizado passou; falta o click-through manual.

---

## Documentação técnica

- `docs/00-vision.md` — produto, persona, JTBD
- `docs/02-architecture.md` — C4 (Context, Container, Sequence)
- `docs/03-domain-model.md` — entidades + invariantes
- `docs/05-zero-friction-onboarding.md` — Sponsored Reserves + Fee Bump
- `docs/06-fiat-onramp-sep24.md` — anchor SEP-24 + Etherfuse
- `docs/07-api-contract.md` — endpoints REST + auth + idempotência
- `docs/specs/2026-05-23-x402-integration-design.md` — design do x402
- `docs/adr/0001..0010` — ADRs com decisões D1–D12
