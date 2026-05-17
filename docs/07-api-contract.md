# 07 — API Contract

> Especificação dos endpoints REST da Aegis API. Contrato versionado em `/v1`.

**Base URL (testnet/dev):** `https://api.aegis-protocol.dev/v1`
**Formato:** JSON. Errors seguem [RFC 7807 Problem Details](https://datatracker.ietf.org/doc/html/rfc7807).

---

## 1. Autenticação

Dois métodos coexistem:

### 1.1 Bearer cr_ (agente programático)
```http
Authorization: Bearer cr_a8x9k2j3m4n5p6q7r8s9t0u1v2w3x4y5
```
- Identifica o **Agent** e por consequência a **Company** dona dele.
- Usado por `@aegis/sdk` quando o agente chama a API.
- Key formato: `cr_<32 chars random base62>`; armazenada como hash (bcrypt/argon2) no DB.
- Mostrada uma única vez no momento de criação no dashboard; admin precisa salvar.

### 1.2 Session cookie (admin no dashboard)
- NextAuth (`next-auth.session-token`) emitido após login via credentials/OAuth.
- Identifica o **User** e a **Company** dele.
- Usado pelo dashboard `apps/web` para todas as chamadas administrativas.

### 1.3 Endpoints públicos (sem auth)
- `GET /healthz`
- `POST /webhooks/anchor` (autenticado via HMAC do anchor, não Bearer/Session)

### 1.4 Erros de auth
- `401 Unauthorized` — token ausente ou inválido.
- `403 Forbidden` — token válido mas sem permissão (ex: User VIEWER tentando POST).

---

## 2. Convenções globais

### 2.1 Idempotência
- `POST /spend-requests` **exige** header `Idempotency-Key: <uuid>`.
- Mesma key + mesmo body → retorna recurso existente (200).
- Mesma key + body diferente → `409 Conflict`.
- Keys persistem por 7 dias.

### 2.2 Versionamento
- Versão na URL: `/v1`.
- Mudanças breaking → `/v2`.
- Headers deprecation em mudanças aditivas: `Deprecation: true`, `Sunset: <RFC 3339>`.

### 2.3 Paginação
- Cursor-based: `?limit=50&cursor=<opaque>`.
- Response inclui `meta: { nextCursor, hasMore }`.

### 2.4 Filtragem e ordenação
- Query params específicos por recurso (documentados abaixo).
- Default sort: `createdAt DESC`.

### 2.5 Datas
- Sempre ISO 8601 UTC: `"2026-05-17T14:32:18.123Z"`.

### 2.6 Valores monetários
- **Sempre em centavos** (`bigint`): `"amountCents": 12345` = $123.45.
- Asset code separado: `"asset": "USDC"`.
- Cliente faz conversão para display.

### 2.7 Erros (formato RFC 7807)
```json
{
  "type": "https://aegis-protocol.dev/errors/policy-rejected",
  "title": "Spend rejected by policy",
  "status": 422,
  "detail": "amount $1500 exceeds maxPerTransactionCents $500",
  "instance": "/v1/spend-requests/9f8e7d6c",
  "policyRuleViolated": "maxPerTransactionCents",
  "spendRequestId": "9f8e7d6c-..."
}
```

Códigos de erro padronizados:
| Code | Descrição |
|------|-----------|
| `400` | Validação Zod falhou |
| `401` | Auth ausente/inválida |
| `403` | Sem permissão |
| `404` | Recurso não existe |
| `409` | Idempotency key conflict, transição de estado inválida |
| `422` | Policy rejected (esperado, não é bug) |
| `429` | Rate limit |
| `500` | Erro interno |
| `502` | Horizon/Soroban/Anchor down |

---

## 3. Endpoints

### 3.1 Spend Requests

#### POST /spend-requests
**Auth:** Bearer cr_  
**Headers:** `Idempotency-Key: <uuid>` (obrigatório)

**Request body:**
```json
{
  "vendorId": "550e8400-e29b-41d4-a716-446655440000",
  "amountCents": 1500,
  "asset": "USDC",
  "actionType": "api-call",
  "reason": "Anthropic /messages call for ticket #4567",
  "metadata": {
    "ticketId": "4567",
    "model": "claude-opus-4-7"
  }
}
```

**Response 200 (decisão imediata, APPROVED + EXECUTED):**
```json
{
  "id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  "status": "EXECUTED",
  "decision": "APPROVED",
  "decisionReason": null,
  "amountCents": 1500,
  "asset": "USDC",
  "txHash": "abc123...",
  "ledger": 47823901,
  "stellarExpertUrl": "https://stellar.expert/explorer/testnet/tx/abc123...",
  "createdAt": "2026-05-17T14:32:18Z",
  "executedAt": "2026-05-17T14:32:21Z"
}
```

**Response 202 (REQUIRES_APPROVAL):**
```json
{
  "id": "...",
  "status": "REQUIRES_APPROVAL",
  "decision": "REQUIRES_APPROVAL",
  "decisionReason": "amount $1500 exceeds humanApprovalThresholdCents $1000",
  "amountCents": 1500,
  "asset": "USDC",
  "approvalDeadline": "2026-05-18T14:32:18Z",
  "createdAt": "2026-05-17T14:32:18Z"
}
```

**Response 422 (REJECTED):**
```json
{
  "type": "https://aegis-protocol.dev/errors/policy-rejected",
  "title": "Spend rejected by policy",
  "status": 422,
  "detail": "vendor 550e... is in policy denyList",
  "spendRequestId": "...",
  "policyRuleViolated": "vendorDenyList"
}
```

#### GET /spend-requests/:id
**Auth:** Bearer cr_ (mesmo agente) ou Session (admin da Company).

**Response:** SpendRequest completo.

#### GET /spend-requests
**Auth:** Session (admin) ou Bearer cr_ (filtrado ao agente).

**Query params:** `?agentId=...&status=...&vendorId=...&from=...&to=...&limit=50&cursor=...`

---

### 3.2 Approvals (humano)

#### POST /approvals/:spendRequestId
**Auth:** Session (admin, OWNER ou ADMIN).

**Request:**
```json
{
  "action": "APPROVE",
  "reason": "Reviewed and approved for Q2 budget"
}
```
ou
```json
{
  "action": "REJECT",
  "reason": "Outside approved vendors for this quarter"
}
```

**Response 200:**
```json
{
  "spendRequestId": "...",
  "newStatus": "APPROVED_BY_HUMAN",
  "approval": {
    "id": "...",
    "userId": "...",
    "action": "APPROVE",
    "reason": "...",
    "createdAt": "..."
  }
}
```

**Response 409:** se SpendRequest não está em REQUIRES_APPROVAL.

#### GET /approvals/pending
**Auth:** Session.

**Response:** lista de SpendRequests em REQUIRES_APPROVAL para a Company.

---

### 3.3 Agents

#### POST /agents
**Auth:** Session (ADMIN/OWNER).
**Request:**
```json
{
  "name": "Customer Success Bot",
  "description": "Handles tier-1 support tickets",
  "activePolicyId": "...",
  "metadata": { "team": "cs" }
}
```
**Response 201:**
```json
{
  "id": "...",
  "name": "Customer Success Bot",
  "apiKey": "cr_a8x9k2j3m4n5p6q7r8s9t0u1v2w3x4y5",
  "apiKeyPrefix": "cr_a8x9k2j",
  "status": "ACTIVE",
  "createdAt": "..."
}
```
**`apiKey` é mostrada apenas uma vez. Admin precisa salvar.**

#### GET /agents
**Auth:** Session.
**Response:** lista de Agents (sem `apiKey`, só prefix).

#### GET /agents/:id
**Auth:** Session.

#### PATCH /agents/:id
**Auth:** Session.
**Request:** mudanças permitidas (`name`, `description`, `activePolicyId`, `status`).

#### POST /agents/:id/rotate-key
**Auth:** Session.
**Response:** nova `apiKey` (key antiga vira REVOKED).

#### DELETE /agents/:id (soft-delete)
**Auth:** Session.
**Effect:** `status = REVOKED`. Audit log entry.

---

### 3.4 Policies

#### POST /policies
**Auth:** Session.
**Request:**
```json
{
  "name": "Default Conservative Policy",
  "rules": {
    "maxPerTransactionCents": 50000,
    "monthlyBudgetCents": 100000000,
    "vendorAllowList": [],
    "vendorDenyList": [],
    "actionTypes": ["api-call", "scraping"],
    "humanApprovalThresholdCents": 20000
  }
}
```
**Response 201:** Policy v1.

#### GET /policies
**Auth:** Session.

#### GET /policies/:id
**Auth:** Session.

#### POST /policies/:id/new-version
**Auth:** Session.
**Request:** novas `rules`.
**Response 201:** Policy nova versão, antiga marcada `isActive=false`.

---

### 3.5 Vendors

#### POST /vendors
**Auth:** Session.
**Request:**
```json
{
  "name": "Anthropic",
  "description": "LLM API provider",
  "publicKey": null,
  "signMode": "AEGIS",
  "metadata": { "url": "https://anthropic.com" }
}
```
- Se `publicKey: null` e `signMode: "AEGIS"` → Aegis gera keypair, sponsoreia, salva.
- Se `publicKey: "G..."` e `signMode: "SELF"` → resposta inclui XDR parcial para vendor assinar e submeter via `POST /vendors/:id/submit-sponsorship`.

**Response 201 (modo AEGIS):**
```json
{
  "id": "...",
  "name": "Anthropic",
  "primaryWallet": {
    "id": "...",
    "publicKey": "G...",
    "status": "ACTIVE",
    "sponsorshipTxHash": "abc..."
  },
  "createdAt": "..."
}
```

#### POST /vendors/:id/submit-sponsorship
**Auth:** Session.
**Request:** `{ "signedXdr": "..." }` (apenas modo SELF).
**Response 200:** vendor com `status=ACTIVE`.

#### GET /vendors
**Auth:** Session.

#### GET /vendors/:id

#### PATCH /vendors/:id (name, description, metadata, status)

#### DELETE /vendors/:id
**Auth:** Session.
**Effect:** se vendor tem balance USDC > 0, retorna 409 com instruções. Se balance = 0, revoga sponsorship e marca status `INACTIVE`.

---

### 3.6 Vendor Wallets (gestão avançada)

#### POST /vendor-wallets
**Auth:** Session.
**Request:** `{ "vendorId": "...", "publicKey": "G...", "isPrimary": false }`
**Effect:** adiciona wallet adicional ao vendor (não sponsorea por default; admin pode pedir sponsorship).

#### POST /vendor-wallets/:id/sponsor
**Auth:** Session.
**Effect:** dispara fluxo sponsoring (mesmo que cadastro novo).

---

### 3.7 Fiat Ramp

#### POST /fiat/deposits
**Auth:** Session.
**Request:**
```json
{ "amountCents": 100000, "asset": "USDC" }
```
**Response 201:**
```json
{
  "id": "...",
  "status": "INITIATED",
  "interactiveUrl": "https://testanchor.stellar.org/sep24/transactions/deposit/interactive?token=xyz",
  "anchorTransactionId": "abc-anchor-id",
  "expiresAt": "..."
}
```

#### POST /fiat/withdrawals
**Auth:** Session.
**Request:** `{ "amountCents": 50000, "asset": "USDC" }`
**Response 201:** mesma estrutura de deposit.

#### POST /fiat/withdrawals/:id/send-usdc
**Auth:** Session.
**Effect:** após admin completar dados bancários no modal, dispara o Payment USDC: treasury → anchor com Memo correto.

#### GET /fiat/deposits, GET /fiat/withdrawals

#### POST /webhooks/anchor
**Auth:** HMAC signature header (segredo compartilhado com anchor).
**Effect:** atualiza status do FiatDeposit/Withdrawal correspondente.

---

### 3.8 Treasury

#### GET /treasury
**Auth:** Session.
**Response:**
```json
{
  "publicKey": "G_AEGIS_TR",
  "network": "TESTNET",
  "stellarExpertUrl": "https://stellar.expert/explorer/testnet/account/G_AEGIS_TR",
  "balances": [
    { "asset": "USDC", "balance": "1234.5600000", "balanceCents": 123456 },
    { "asset": "XLM", "balance": "9876.5432100", "isNative": true }
  ],
  "sponsoredVendorCount": 12,
  "estimatedXlmLockedInSponsorships": "12.0000000"
}
```

#### GET /treasury/transactions
**Auth:** Session.
**Effect:** proxies o Horizon `/accounts/:id/transactions` filtrando por relevantes (Payment USDC, sponsorships, claim balances).

---

### 3.9 Audit Events

#### GET /audit
**Auth:** Session.
**Query params:** `?eventType=...&actor=...&from=...&to=...&spendRequestId=...&limit=50&cursor=...`
**Response:**
```json
{
  "data": [
    {
      "id": "...",
      "eventType": "DECISION_MADE",
      "actor": "agent:550e...",
      "payload": { "decision": "APPROVED", ... },
      "sorobanTxHash": "soroban-tx-abc...",
      "sorobanEmittedAt": "2026-05-17T14:32:25Z",
      "createdAt": "2026-05-17T14:32:18Z"
    }
  ],
  "meta": { "nextCursor": "...", "hasMore": true }
}
```

#### GET /audit/:id

#### GET /audit/export.csv
**Auth:** Session.
**Effect:** stream CSV com filtros aplicados.

---

### 3.10 Companies & Users

#### GET /companies/me
**Auth:** Session.
**Response:** Company atual + user role.

#### POST /companies/me/users (invite)
**Auth:** Session (OWNER).
**Request:** `{ "email": "...", "role": "ADMIN" }`
**Effect:** envia invite email; cria User pendente.

#### GET /companies/me/users

---

### 3.11 Health & meta

#### GET /healthz
**Response 200:**
```json
{
  "status": "ok",
  "checks": {
    "db": "ok",
    "horizon": "ok",
    "soroban": "ok",
    "anchor": "ok"
  },
  "version": "0.1.0",
  "network": "testnet"
}
```

#### GET /metrics (Prometheus format)
**Auth:** IP allowlist (não exposto publicamente).

---

## 4. Rate limits

Default por agentId:
- `POST /spend-requests`: 10 req/s (configurável por Agent).
- Outros endpoints: 30 req/s.

Headers de resposta:
```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 8
X-RateLimit-Reset: 1734567890
```

Excede → `429 Too Many Requests` com header `Retry-After: <seconds>`.

---

## 5. SDK TypeScript (`@aegis/sdk`)

### Instalação
```bash
npm install @aegis/sdk
```

### Uso (MVP scope)
```ts
import { AegisClient } from "@aegis/sdk";

const aegis = new AegisClient({
  apiKey: process.env.AEGIS_API_KEY!, // cr_...
  baseUrl: "https://api.aegis-protocol.dev/v1",
});

// Pagar um vendor
const result = await aegis.pay({
  vendorId: "550e...",
  amountCents: 1500,
  asset: "USDC",
  actionType: "api-call",
  reason: "Anthropic /messages call",
  idempotencyKey: crypto.randomUUID(),
  metadata: { ticketId: "4567" },
});

if (result.status === "EXECUTED") {
  console.log("Paid:", result.txHash);
} else if (result.status === "REQUIRES_APPROVAL") {
  console.log("Waiting human approval:", result.id);
}
```

### Erros tipados
```ts
import { PolicyRejectedError, RateLimitError } from "@aegis/sdk";

try {
  await aegis.pay({...});
} catch (e) {
  if (e instanceof PolicyRejectedError) {
    console.log("Rejeitado:", e.detail, "regra:", e.policyRuleViolated);
  } else if (e instanceof RateLimitError) {
    await sleep(e.retryAfterMs);
  }
}
```

### Helpers HTTP 402
```ts
// Quando agente recebe 402 de um vendor
const resp = await fetch(vendorUrl);
if (resp.status === 402) {
  const invoice = aegis.parseHttp402(resp);
  const payment = await aegis.payInvoice(invoice, { idempotencyKey: ... });
  const resp2 = await fetch(vendorUrl, {
    headers: { 'X-Payment-Proof': payment.txHash }
  });
}
```

---

## 6. OpenAPI

OpenAPI 3.1 spec será mantida em `apps/api/openapi.yaml` (gerada a partir dos Zod schemas via `zod-to-openapi`). Swagger UI exposto em `/v1/docs`.
