# Aegis Protocol — Engenharia Reversa

> Análise arquitetural baseada no código real do repositório (`release/stellar`, 2026-05-20).
> Este documento complementa a `docs/` existente mostrando **o que foi efetivamente implementado**,
> como cada camada funciona internamente, e o gap entre spec e código atual.

---

## 1. Visão Executiva

**Aegis Protocol** é um gateway de pagamento com governança embutida para agentes de IA autônomos. O produto resolve um problema real: agentes que precisam gastar dinheiro em produção (via HTTP 402 ou pagamentos diretos) não têm hoje uma camada que decida aprovação/rejeição, execute o pagamento on-chain de forma auditável e permita intervenção humana quando necessário.

### Estado do projeto hoje

| Item | Status |
|------|--------|
| Iterações concluídas | 1–11 de 13 (iter 12 = HTTP 402 demo, iter 13 = hardening) |
| Marco do roadmap | Marco 1 — MVP Testnet (quase completo) |
| Rede Stellar | Testnet exclusivamente |
| Contrato Soroban | Stub compilável — `record_decision` ainda não implementado |
| Fiat on/off-ramp | SEP-24 (testanchor.stellar.org) + Etherfuse (sandbox BRL/MXN) |
| Dashboard web | Operacional com NextAuth + CRUD completo + aprovações |

### Stack completa

```
Monorepo: Turborepo + pnpm 10 + TypeScript 5.7 + Node 22
API:      Fastify + Zod + Prisma
Web:      Next.js 14 App Router + Tailwind + NextAuth
DB:       PostgreSQL via Neon (serverless)
Stellar:  @stellar/stellar-sdk — Horizon + Soroban RPC
Fiat:     SEP-24 (testanchor) + Etherfuse API (BRL/MXN)
Contrato: Rust + soroban-sdk (stub)
```

---

## 2. Estrutura do Monorepo

```
aegis-protocol/
├── apps/
│   ├── api/          → Fastify REST gateway (Node 22)
│   └── web/          → Next.js 14 dashboard admin
├── packages/
│   ├── shared/       → @aegis/shared: tipos, schemas Zod, enums
│   ├── policy-engine/→ @aegis/policy-engine: função pura evaluate()
│   ├── stellar/      → @aegis/stellar: Stellar SDK adapter, SEP-10/24, Etherfuse
│   └── sdk/          → @aegis/sdk: cliente HTTP para agentes de IA
├── contracts/
│   └── aegis-audit/  → Rust + soroban-sdk: contrato de auditoria on-chain
├── examples/
│   └── simple-agent/ → Exemplo standalone usando @aegis/sdk
├── docs/             → Documentação de produto, arquitetura, ADRs
└── turbo.json        → Pipeline Turborepo (build → test → lint)
```

### Convenções de código

- **IDs**: UUID v4 em todas as entidades (`@db.Uuid + @default(uuid())`)
- **Valores monetários**: `BigInt` em centavos USD no banco; `number` nas interfaces internas
- **Tabelas**: `snake_case` via `@@map()` no Prisma
- **Enums**: string-based (compatibilidade JSON + Prisma)
- **Erros**: discriminated union — nunca `throw` na policy engine; erros tipados na API (`NotFoundError`, `PolicyRejectedError`, `UnauthorizedError`, `StellarError`)
- **Secrets**: jamais persistidos no DB; chave da treasury referenciada por nome de env var (`secretKeyEnvVar`)

---

## 3. Camada de Domínio — `@aegis/shared`

**Localização:** `packages/shared/src/`

É a biblioteca de tipos compartilhados entre todos os packages. Não tem lógica de negócio — só definições.

### Arquivos

| Arquivo | Responsabilidade |
|---------|-----------------|
| `enums.ts` | Todos os enums do domínio (string-based) |
| `schemas.ts` | Schemas Zod — fonte de verdade para validação |
| `types.ts` | Tipos TypeScript derivados via `z.infer<>` |
| `decision.ts` | Tipo `Decision` (discriminated union de 3 decisões) |
| `adapters.ts` | Interface `SettlementAdapter` — contrato para múltiplas chains |

### Enums principais

```typescript
// Decisão da policy engine
DecisionType: APPROVED | REQUIRES_APPROVAL | REJECTED

// Ciclo de vida de um gasto
SpendRequestStatus: CREATED → APPROVED | REQUIRES_APPROVAL | REJECTED
                    APPROVED → EXECUTING → EXECUTED | EXECUTION_FAILED
                    REQUIRES_APPROVAL → APPROVED_BY_HUMAN | REJECTED_BY_HUMAN
                    (+ EXPIRED)

// Regras identificadas no retorno de rejeição
PolicyRuleName: actionTypes | vendorDenyList | vendorAllowList |
                maxPerTransactionCents | monthlyBudgetCents | humanApprovalThresholdCents
```

### Schema da Policy (DSL)

```typescript
PolicyRulesSchema = {
  maxPerTransactionCents:        number | null,  // null = sem limite
  monthlyBudgetCents:            number | null,
  vendorAllowList:               string[],        // [] = todos permitidos
  vendorDenyList:                string[],        // deny vence allow
  actionTypes:                   string[],        // [] = qualquer tipo
  humanApprovalThresholdCents:   number | null,
  pathPaymentSlippage:           number (0–1),    // default 0.01 = 1%
}
```

### Interface `SettlementAdapter`

Contrato que permite trocar a chain de liquidação no futuro sem reescrever o núcleo. Hoje só `@aegis/stellar` implementa. Preparada para Solana, Base, etc. (ADR-0001).

---

## 4. Policy Engine — `@aegis/policy-engine`

**Localização:** `packages/policy-engine/src/evaluate.ts`

O coração do sistema. Função pura `evaluate(request, policy, context) → Decision`.

### Características críticas (ADR-0006)

- **Zero I/O**: sem `await`, sem rede, sem DB, sem `Date.now()`, sem `Math.random()`
- **Determinística**: mesmas entradas → mesma saída sempre
- **Nunca lança exceção**: retorna discriminated union
- **Imutável**: não muda os inputs

### Ordem canônica de avaliação (6 regras)

```
1. actionTypes        → REJECTED se tipo não permitido
2. vendorDenyList     → REJECTED se vendor bloqueado (vence allowList)
3. vendorAllowList    → REJECTED se vendor não está na lista (quando lista não vazia)
4. maxPerTransactionCents → REJECTED se valor acima do limite por transação
5. monthlyBudgetCents → REJECTED se gasto mensal + request excede budget
6. humanApprovalThresholdCents → REQUIRES_APPROVAL (não rejeita, escala)
   (fallback) → APPROVED
```

A ordem importa: deny list é avaliada antes de allow list (regra de segurança explícita).

### RuntimeContext

O orchestrator (`apps/api`) pré-carrega antes de chamar a engine:
```typescript
{
  monthlySpentCents: number  // SUM(amountCents) WHERE status=EXECUTED AND month=atual
}
```

Este valor vem de query agregada no PostgreSQL. A engine não faz a query — recebe pronto.

---

## 5. Pacote Stellar — `@aegis/stellar`

**Localização:** `packages/stellar/src/`

Implementação completa do `SettlementAdapter` para a rede Stellar.

### Arquivos principais

| Arquivo | Função |
|---------|--------|
| `payment.ts` | Executa Payment USDC ou PathPaymentStrictReceive (cross-currency) |
| `sponsoring.ts` | CAP-33: cria conta vendor com 0 XLM + trustline patrocinados |
| `sep10.ts` | Autenticação Stellar Web Auth (JWT para anchors) — com cache LRU |
| `sep24.ts` | Deposit/withdraw interativo via anchor SEP-24 |
| `anchor-toml.ts` | Lê TOML do anchor (webAuth endpoint, SIGNING_KEY, transferServer) |
| `encryption.ts` | Criptografia simétrica AES-256-GCM para secrets de vendors |
| `etherfuse/client.ts` | Cliente da API Etherfuse (on-ramp BRL/MXN via Pix/SPEI) |
| `keypair.ts` | Geração e gestão de keypairs Stellar |
| `horizon.ts` | Instância do Horizon.Server |
| `network.ts` | Config de rede (passphrase, URLs Horizon/Soroban) |
| `assets.ts` | Assets canônicos (USDC testnet/mainnet, EURC, etc.) |

### Lógica de pagamento (`payment.ts`)

Ramifica em dois caminhos com base no asset preferido do vendor:

```
sourceAsset === destAsset (ex: USDC → USDC)
  → Operation.payment (simples)

sourceAsset !== destAsset (ex: USDC → BRL)
  → Operation.pathPaymentStrictReceive
  → consulta DEX via horizon.strictReceivePaths()
  → aplica slippage: sendMax = bestPath.source_amount × (1 + slippage)
  → falha explícita se não há liquidez no DEX
```

Memo na transação: `Memo.hash(sha256(spendRequestId))` — permite rastrear qualquer tx Stellar de volta ao spend request.

### Vendor onboarding patrocinado (`sponsoring.ts`)

Transação atômica de 4 operações assinada por **duas chaves** (treasury + vendor):

```
Op 1: BeginSponsoringFutureReserves(sponsoredId=vendor)  ← treasury assina
Op 2: CreateAccount(vendor, startingBalance=0)            ← treasury assina
Op 3: ChangeTrust(source=vendor, asset=preferredAsset)   ← vendor assina
Op 4: EndSponsoringFutureReserves(source=vendor)         ← vendor assina
```

Resultado: vendor tem conta Stellar com trustline aberta para USDC/EURC/BRL sem nunca possuir XLM. A treasury trava ~1 XLM em reserves (recuperável via `RevokeSponsorship`).

### SEP-10 — Autenticação com anchor (`sep10.ts`)

Fluxo de 4 passos para obter JWT válido do anchor:
1. `GET <webAuthEndpoint>?account=<treasuryPK>` → challenge XDR
2. Valida assinatura do anchor via `WebAuth.readChallengeTx()`
3. Assina challenge com treasury keypair
4. `POST <webAuthEndpoint>` → recebe JWT

JWT é cacheado em LRU (max 50 entradas) com TTL derivado do `exp` claim, com buffer de 60s para refresh proativo. Sem cache, cada operação SEP-24 custaria uma roundtrip extra.

### SEP-24 — Fiat on/off-ramp (`sep24.ts`)

Integra com `testanchor.stellar.org` para operações fiat↔USDC:
- **Deposit**: inicia sessão interativa → retorna URL para admin completar KYC/dados bancários
- **Withdrawal**: idem na direção inversa
- Poll de status via `GET /transaction?id=<anchorTransactionId>` até estado terminal

### Etherfuse — BRL/MXN via Pix/SPEI (`etherfuse/`)

API alternativa ao SEP-24 para mercados latino-americanos:
- **Quote** → **Order** → **Instruções Pix** (chave, valor, QR code)
- Admin paga via app bancário; Etherfuse emite asset Stellar para a treasury
- Sandbox: `POST /ramp/order/:id/fiat_received` simula recebimento sem Pix real
- Polling com debounce de 30s (`STALE_POLL_MS`) para não sobrecarregar a API

---

## 6. SDK para Agentes — `@aegis/sdk`

**Localização:** `packages/sdk/src/`

Cliente TypeScript que agentes de IA importam para interagir com a Aegis API.

### Design

- **Zero dependências**: usa `fetch` global — funciona em Node 22+, Bun, Deno, Cloudflare Workers
- **API key validada no construtor**: deve começar com `cr_`
- **Timeout configurável**: AbortController com `clearTimeout` no finally
- **Idempotência automática**: gera UUID v4 se `idempotencyKey` não fornecido

### Método principal

```typescript
const aegis = new AegisClient({ apiKey: 'cr_...', baseUrl: '...' });
const result = await aegis.pay({
  vendorId: '...',
  amountCents: 1500,       // 15 centavos de USDC
  asset: 'USDC',
  actionType: 'api-call',
  reason: 'LLM call for ticket #4567',
});
// result.status: 'EXECUTED' | 'PENDING_APPROVAL' | 'REJECTED'
```

### Mapeamento de status HTTP → erros tipados

| HTTP | Exceção |
|------|---------|
| 422 | `PolicyRejectedError` — com `ruleHit` identificando a regra |
| 409 | `IdempotencyConflictError` |
| 429 | `RateLimitError` |
| 4xx | `AegisApiError` |
| Timeout/rede | `NetworkError` |

---

## 7. API — `apps/api`

**Localização:** `apps/api/src/`

Fastify server que orquestra toda a lógica de negócio.

### Inicialização (`server.ts`)

Ordem de registro dos plugins é determinística e importa:

```
1. error-handler     (intercepta erros antes de qualquer response)
2. helmet + cors
3. prisma            (decora app.prisma)
4. stellar           (decora app.stellar — adapter Stellar)
5. etherfuse         (decora app.etherfuse — cliente Etherfuse)
6. auth-agent        (decora request.agent — depende de prisma)
7. rate-limit
8. rotas (healthz, auth, companies, treasury, agents, policies,
          vendors, spend-requests, approvals, audit, fiat)
```

### Autenticação de agentes (`plugins/auth-agent.ts`)

Estratégia de dois estágios para minimizar latência no hot path:

```
1. Extrai Bearer cr_<apiKey> do header Authorization
2. Busca prefix (11 chars: "cr_" + 8) indexado no DB → candidates[]
3. bcrypt.compare(apiKey, candidate.apiKeyHash) por candidato
4. Cache LRU (max 1.000 entradas, TTL 5 min) — bcrypt caro (~10ms)
```

Revogação de Agent não é imediata (até 5 min pelo cache). Aceitável para MVP; produção precisaria de Redis pub/sub para invalidação instantânea.

### Rotas implementadas

| Rota | Descrição |
|------|-----------|
| `GET /healthz` | Health check + treasury public key |
| `POST /v1/auth/login` | Login email/senha → sessão NextAuth |
| `GET/POST /v1/companies` | CRUD de Companies |
| `GET/POST /v1/agents` | CRUD de Agents + geração de API key |
| `GET/POST /v1/policies` | CRUD de Policies |
| `GET/POST /v1/vendors` | CRUD de Vendors + sponsoring on-chain |
| `POST /v1/spend-requests` | Fluxo principal: avalia → (executa) → responde |
| `GET /v1/spend-requests` | Lista com filtros (status, agentId, vendorId) |
| `POST /v1/approvals/:id` | Aprovação/rejeição humana de SpendRequest escalada |
| `GET /v1/audit` | Eventos de auditoria por Company |
| `POST /v1/fiat/deposits` | Inicia depósito fiat (SEP-24 ou Etherfuse) |
| `POST /v1/fiat/withdrawals` | Inicia saque fiat (SEP-24 ou Etherfuse) |
| `GET /v1/treasury` | Info da treasury Stellar |

### Serviço central: `spend-request.ts` + `payment-executor.ts`

O fluxo de SpendRequest é orquestrado em dois passos sequenciais:

**Passo 1 — `createSpendRequest()`:**
1. Verifica idempotência `(companyId, idempotencyKey)` — retorna existente se já criado
2. Carrega Policy + RuntimeContext (query mensal agregada) + Vendor
3. Chama `evaluate(request, policy, context)` — síncrono, <1ms
4. Persiste SpendRequest com `decision` + `policySnapshot` (snapshot imutável da policy)
5. Persiste AuditEvent `DECISION_MADE`

**Passo 2 — `executeSpendRequestPayment()`:**
1. Lock otimista: `UPDATE ... WHERE status IN (APPROVED, APPROVED_BY_HUMAN) → EXECUTING`
   - Race condition segura: apenas um caller promove o status
2. Resolve VendorWallet primária com status `ACTIVE` ou `SPONSORED_BY_AEGIS`
3. Calcula `memoHash = sha256(spendRequestId)` para rastreabilidade on-chain
4. Chama `app.stellar.executePayment(...)` com slippage do policy snapshot
5. Sucesso: `UPDATE EXECUTED` + `AuditEvent PAYMENT_EXECUTED` em `$transaction`
6. Falha: `UPDATE EXECUTION_FAILED` + `AuditEvent PAYMENT_FAILED` em `$transaction`

---

## 8. Dashboard Web — `apps/web`

**Localização:** `apps/web/app/`

Next.js 14 com App Router, Tailwind CSS e NextAuth.

### Autenticação

NextAuth com provider de credenciais (email + senha). Middleware protege todas as rotas do grupo `(app)/` — redirect para `/login` se sem sessão.

### Páginas implementadas

| Rota | Funcionalidade |
|------|----------------|
| `/` (dashboard) | Visão geral — spend requests recentes, saldo treasury |
| `/agents` | CRUD de agentes de IA |
| `/policies` | CRUD de políticas |
| `/vendors` | CRUD de vendors + sponsoring |
| `/spend-requests` | Lista de gastos com filtros |
| `/approvals` | Fila de aprovações pendentes — ação Approve/Reject |
| `/audit` | Log de eventos de auditoria |
| `/fiat` | Depósito e saque fiat (SEP-24 + Etherfuse) |

### Arquitetura Next.js

- Server Components para listagens (sem JS no cliente)
- Server Actions (`lib/actions.ts`) para mutations (POST/PATCH via API)
- `lib/api.ts` — wrapper fetch com autenticação de sessão

---

## 9. Contrato Soroban — `contracts/aegis-audit`

**Localização:** `contracts/aegis-audit/src/lib.rs`

**Estado atual: stub mínimo.**

```rust
#[contractimpl]
impl AegisAudit {
    pub fn ping(_env: Env) -> Symbol {
        symbol_short!("pong")  // só confirma que compila e pode ser invocado
    }
}
```

O contrato compila, faz deploy em testnet e passa no teste unitário `ping_returns_pong`. Mas a função `record_decision` — que deve emitir um evento Soroban por decisão com `companyId` indexado como topic — **ainda não foi implementada**. Está prevista para a iteração 12/13 (ADR-0003 descreve o design completo).

Design planejado para `record_decision`:
- Topics: `["aegis_decision", companyId, decisionType]`
- Data: `{ spendRequestId, agentId, vendorId, amountCents, asset, policyId, ruleHit?, timestamp }`
- Sem storage on-chain (contrato stateless por design)
- Emissão assíncrona pelo `apps/api` após execução do pagamento

---

## 10. Banco de Dados — Prisma Schema

**Localização:** `apps/api/prisma/schema.prisma`

12 entidades, PostgreSQL via Neon serverless.

### Entidades e responsabilidades

| Entidade | Responsabilidade |
|----------|-----------------|
| `Company` | Tenant raiz — tudo pertence a uma Company |
| `User` | Humano admin (OWNER/ADMIN/VIEWER); passwordHash bcrypt |
| `Agent` | Agente de IA — tem API key (hash+prefix) e activePolicy |
| `Policy` | Regras JSON (PolicyRulesSchema) + versioning via `supersedesPolicyId` |
| `Vendor` | Serviço externo que recebe pagamentos; tem `preferredAsset` |
| `VendorWallet` | Conta Stellar do vendor; secret cifrada com AES-256-GCM se Modo AEGIS |
| `SpendRequest` | Pedido de gasto — núcleo do sistema; contém policySnapshot imutável |
| `Approval` | Decisão humana sobre SpendRequest em REQUIRES_APPROVAL |
| `AuditEvent` | Log imutável de eventos; `sorobanTxHash` NULL enquanto emissão on-chain pendente |
| `TreasuryAccount` | Config da conta Stellar da Aegis; secret NUNCA no DB |
| `FiatDeposit` | Operação de entrada fiat (SEP-24 ou Etherfuse) |
| `FiatWithdrawal` | Operação de saída fiat |

### Multi-tenancy

`companyId` presente em toda entidade tenant-bound. Todas as queries filtram por `companyId` derivado do Bearer token ou sessão. Índices em `(companyId, ...)` garantem isolamento e performance.

### Máquina de estados da SpendRequest

```
CREATED
  ├─→ APPROVED          (policy: APPROVED)
  │     └─→ EXECUTING   (lock otimista)
  │           ├─→ EXECUTED
  │           └─→ EXECUTION_FAILED
  ├─→ REQUIRES_APPROVAL (policy: REQUIRES_APPROVAL)
  │     ├─→ APPROVED_BY_HUMAN → EXECUTING → ...
  │     └─→ REJECTED_BY_HUMAN
  ├─→ REJECTED          (policy: REJECTED)
  └─→ EXPIRED
```

### Invariante crítica

`policySnapshot` (campo JSON no SpendRequest) captura as regras da política **no momento da decisão**. Políticas podem evoluir; o snapshot garante que uma auditoria futura reproduza exatamente a decisão tomada, mesmo que a policy tenha sido atualizada depois.

---

## 11. Fluxos Críticos End-to-End

### 11.1 SpendRequest — caminho feliz (APPROVED)

```
Agent
  → SDK: aegis.pay({ vendorId, amountCents, asset, actionType })
  → API POST /v1/spend-requests (Bearer cr_, Idempotency-Key: uuid)
  → auth-agent plugin: busca prefix no DB + bcrypt (ou cache LRU)
  → createSpendRequest():
      → load Policy + RuntimeContext (monthlySpentCents)
      → evaluate(request, policy, ctx) → APPROVED
      → INSERT SpendRequest(status=APPROVED, policySnapshot)
      → INSERT AuditEvent(DECISION_MADE)
  → executeSpendRequestPayment():
      → UPDATE SpendRequest WHERE status=APPROVED → EXECUTING (lock)
      → load VendorWallet primária
      → memoHash = sha256(spendRequestId)
      → app.stellar.executePayment(destPK, amountCents, destAsset, slippage, memoHash)
          → horizon.loadAccount(treasury)
          → se USDC→USDC: Operation.payment
          → se USDC→BRL: horizon.strictReceivePaths() → PathPaymentStrictReceive
          → tx.sign(treasuryKeypair) → horizon.submitTransaction()
          → retorna { txHash, ledger }
      → $transaction: UPDATE EXECUTED + INSERT AuditEvent(PAYMENT_EXECUTED)
  → API responde 201 { status: EXECUTED, txHash, ... }
  → SDK retorna ao agente
```

### 11.2 SpendRequest — escalada para humano (REQUIRES_APPROVAL)

```
Agent → API: POST /v1/spend-requests (valor alto)
  → evaluate() → REQUIRES_APPROVAL
  → INSERT SpendRequest(status=REQUIRES_APPROVAL)
  → API responde 202 { status: PENDING_APPROVAL, requestId }

Admin → Dashboard: GET /approvals (lista pendentes)
  → clica Approve/Reject
  → POST /v1/approvals/:id { action: APPROVED | REJECTED }
  → UPDATE SpendRequest(APPROVED_BY_HUMAN | REJECTED_BY_HUMAN)
  → se APPROVED_BY_HUMAN: executeSpendRequestPayment() → mesmo fluxo acima
```

### 11.3 Vendor onboarding (CAP-33)

```
Admin → Dashboard: POST /v1/vendors { name, preferredAsset }
  → API gera keypair do vendor (Modo AEGIS)
  → @aegis/stellar: sponsorVendor()
      → Tx atômica 4 ops (treasury + vendor assinam)
      → horizon.submitTransaction()
      → vendor tem conta com 0 XLM + trustline USDC/EURC/BRL aberta
  → INSERT Vendor + VendorWallet(status=SPONSORED_BY_AEGIS)
  → secret key do vendor cifrada com AES-256-GCM → salva no DB
```

### 11.4 Fiat on-ramp SEP-24

```
Admin → Dashboard: POST /v1/fiat/deposits { amount, asset: USDC, provider: sep24 }
  → sep10: GET <anchor>/auth?account=treasury → challenge XDR
  → valida assinatura do anchor (WebAuth.readChallengeTx)
  → assina challenge com treasury keypair → POST <anchor>/auth → JWT (cacheado LRU)
  → sep24InitiateDeposit(jwt, USDC, amount)
      → POST <anchor>/transactions/deposit/interactive
      → retorna { id, url } — URL da página KYC do anchor
  → INSERT FiatDeposit(status=INITIATED, anchorTransactionId, interactiveUrl)
  → Admin abre URL no browser → preenche dados bancários no anchor
  → Anchor processa fiat e envia USDC para treasury
  → Polling via GET /fiat/deposits/:id/refresh detecta COMPLETED
```

### 11.5 Fiat on-ramp Etherfuse (BRL/MXN via Pix)

```
Admin → Dashboard: POST /v1/fiat/deposits { sourceAsset: BRL, targetAsset: USDC, ... }
  → EtherfuseClient.createQuote({ sourceAsset: BRL, targetAsset: USDC:G..., amount })
  → EtherfuseClient.createOrder({ quoteId, publicKey: treasury })
      → retorna { orderId, paymentInstructions: { pixKey, value, expiresAt } }
  → INSERT FiatDeposit(status=PENDING_USER_TRANSFER, instructions=paymentInstructions)
  → Admin copia chave Pix e paga no app bancário
  → Etherfuse detecta Pix → emite asset Stellar para treasury
  → Polling (GET /ramp/order/:id) sincroniza status no DB
  → Sandbox: POST /ramp/order/:id/fiat_received simula Pix sem pagamento real
```

---

## 12. Gap Analysis — Spec vs. Código Implementado

### O que está implementado e funcionando

| Componente | Implementado |
|------------|-------------|
| Policy Engine puro (6 regras) | ✅ Completo, testado |
| Prisma schema (12 entidades) | ✅ Completo + seed |
| API REST CRUD (todas as entidades) | ✅ Completo |
| Auth por Bearer cr_ + LRU cache | ✅ Completo |
| SpendRequest end-to-end (APPROVED) | ✅ Completo com lock otimista |
| SpendRequest REQUIRES_APPROVAL | ✅ Completo |
| Aprovação humana via dashboard | ✅ Completo |
| Vendor onboarding CAP-33 (sponsored) | ✅ Completo |
| Payment USDC direto (Horizon) | ✅ Completo |
| PathPaymentStrictReceive (cross-currency) | ✅ Completo com slippage |
| Idempotência (header + DB unique) | ✅ Completo |
| Rate limiting | ✅ Completo |
| SEP-10 auth com JWT cache LRU | ✅ Completo |
| SEP-24 deposit (testanchor) | ✅ Completo |
| SEP-24 withdrawal (testanchor) | ✅ Completo |
| Etherfuse on-ramp BRL/MXN | ✅ Completo (sandbox) |
| Etherfuse off-ramp BRL/MXN | ✅ Completo (sandbox) |
| Dashboard Next.js (todas as páginas) | ✅ Completo |
| @aegis/sdk para agentes | ✅ Completo (23 testes Vitest) |
| Secret key vendor cifrada AES-256 | ✅ Completo |

### O que ainda está pendente (spec vs. realidade)

| Componente | Status | Observação |
|------------|--------|------------|
| Contrato Soroban `record_decision` | ⚠️ Stub | Função `ping` apenas; iteração 12/13 |
| Emissão assíncrona de evento Soroban | ⚠️ Não implementada | AuditEvent salvo no DB; sorobanTxHash=NULL |
| HTTP 402 demo end-to-end | ⚠️ Pendente | Iteração 12 — vendor mock + Claude tool_use |
| Observabilidade (Prometheus, Sentry) | ⚠️ Pendente | Iteração 13 — hardening MVP |
| Kill switch via Clawback (asset aUSD) | ❌ Não iniciado | Stretch S1, Marco 2 |
| KMS para treasury secret | ❌ Não iniciado | Marco 2 |
| Notificações de aprovação (email) | ❌ Não implementado | Especificado no diagrama de sequência |
| Webhook para status de SpendRequest | ❌ Não iniciado | Stretch S3 |

### Desvios intencionais

- **AuditEvent Soroban é assíncrono**: a spec prevê `fire-and-forget com retry queue`. O código persiste o evento no DB imediatamente com `sorobanTxHash=NULL`. A emissão on-chain (que preencheria esse campo) aguarda o contrato Soroban completo.
- **Revogação de Agent**: cache LRU de 5 min significa que um agente revogado continua ativo por até 5 min. Documentado como trade-off aceitável para MVP.
- **Modo SELF de vendor** (vendor fornece própria chave): enum existe no schema mas lógica de execução de pagamento usa sempre o keypair armazenado — Modo SELF ainda não tem suporte completo de signing.

---

## 13. Decisões Arquiteturais Mapeadas no Código

| Decisão | ADR | Como aparece no código |
|---------|-----|------------------------|
| Stellar como única chain do MVP | ADR-0001 | `ChainType.STELLAR` único enum; `SettlementAdapter` preparado para extensão |
| USDC via anchor SEP-24 | ADR-0002 | `sep24.ts`, `sep10.ts`, assets canônicos em `assets.ts` |
| Soroban contract global (sem storage) | ADR-0003 | `lib.rs` stateless; AuditEvent no DB como backup |
| Hot wallet no MVP | ADR-0004 | `secretKeyEnvVar` no DB; secret em variável de ambiente |
| HTTP 402 como gateway | ADR-0005 | SDK com `PolicyRejectedError` + HTTP 402 helpers em `http-402.ts` |
| Policy engine puro sem I/O | ADR-0006 | `evaluate.ts` — nenhum import async, sem side effects |
| Prisma + Neon | ADR-0007 | `prisma/schema.prisma` + `directUrl` para migrações |
| Monorepo Turborepo | ADR-0008 | `turbo.json`, `pnpm-workspace.yaml` |
| Sponsored Reserves + Fee Bump | ADR-0009 | `sponsoring.ts` — CAP-33 implementado |
| Kill switch como stretch | ADR-0010 | Enum `KILL_SWITCH_ACTIVATED` existe mas fluxo não implementado |

---

## 14. Superfície de Segurança Observada

| Área | Implementação atual | Risco / Nota |
|------|---------------------|--------------|
| API key armazenamento | bcrypt hash + prefix indexado | Seguro; revogação não imediata (5 min cache) |
| Treasury secret | Env var (`secretKeyEnvVar`); nunca no DB | Seguro para testnet; KMS necessário antes de mainnet |
| Vendor secret | AES-256-GCM cifrado no DB com `VENDOR_KEY_ENCRYPTION_KEY` | Aceitável; rotação de chave não implementada |
| Idempotência | Unique constraint `(companyId, idempotencyKey)` + lock otimista | Protege contra double-spend |
| Rate limit | Plugin Fastify por IP/apiKey | Mitigação básica; sem circuit breaker ainda |
| Multi-tenancy | `companyId` em todo query; derivado do token | Isolamento correto; sem testes de boundary explícitos |
| CORS/Helmet | Configurado com `origin: true` | Permissivo para MVP; restringir antes de mainnet |

---

*Documento gerado por análise do código em `release/stellar` (commit `46564da`). Atualizar após iterações 12–13 e ao completar contrato Soroban.*
