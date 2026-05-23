# x402 Protocol Integration Design

**Date:** 2026-05-23
**Branch:** feature/protocol-x402
**Status:** Approved — ready for implementation

## Context

The current Aegis HTTP 402 implementation is generic: the vendor-mock emits a custom JSON body `{ amount, asset, to, memo, network }` and the SDK (`packages/sdk/src/http-402.ts`) tries to normalize multiple ad-hoc formats. This is incompatible with the x402 ecosystem and not interoperable with any real x402-speaking vendor.

x402 (https://www.x402.org / github.com/coinbase/x402) is an open standard for internet-native payments using HTTP 402. It defines standard headers, a facilitator model for on-chain verification, and SDKs for EVM, Stellar, and Solana.

## Decisions

| Question | Decision |
|---|---|
| Scope | End-to-end: vendor-mock (server) + SDK (client) + Aegis API (facilitator) |
| Network | Stellar (existing infrastructure) |
| Facilitator | Aegis API itself (`POST /v1/x402/verify`, `POST /v1/x402/settle`) |
| Migration | Replace generic 402 implementation completely |
| Approach | Hybrid C: `@x402/core` types + `@x402/stellar` facilitator logic; no `@x402/fastify` middleware |

**Why not `@x402/fastify` middleware:** it expects the client to pay directly on-chain. In Aegis, payment goes through the governance API (policy evaluation, human approval, Soroban audit trail). Using the middleware would bypass this layer.

## Architecture

### Flow

```
Agent (claude-agent-402)
  │
  │  1. GET /resource
  ▼
Vendor Mock (Fastify)
  │
  │  2. 402 + X-PAYMENT-REQUIRED: base64(PaymentRequirements[])
  ▼
Agent SDK (@aegis/sdk)
  │
  │  3. parsePaymentRequired(response) → PaymentRequirements
  │  4. POST /v1/spend-requests → Aegis API
  ▼
Aegis API
  │
  │  5. Policy evaluation → APPROVED
  │  6. Stellar payment → txHash
  ▼
Agent SDK
  │
  │  7. buildPaymentSignature(txHash, requirement) → base64(PaymentPayload)
  │  8. Retry GET /resource with X-PAYMENT: base64(PaymentPayload)
  ▼
Vendor Mock
  │
  │  9. POST /v1/x402/verify → Aegis Facilitator
  ▼
Aegis API (/v1/x402/verify)
  │
  │  10. @x402/stellar/exact/facilitator.verify(payload, requirements)
  │      Confirms txHash on Stellar blockchain
  │  11. { isValid: true, invalidReason: null }
  ▼
Vendor Mock
  │
  │  12. 200 + resource + X-PAYMENT-RESPONSE: base64(SettleResponse)
  ▼
Agent ✅
```

### Headers

| Header | Direction | Content |
|---|---|---|
| `X-PAYMENT-REQUIRED` | Vendor → Client | base64(JSON `PaymentRequirements[]`) |
| `X-PAYMENT` | Client → Vendor | base64(JSON `PaymentPayload`) |
| `X-PAYMENT-RESPONSE` | Vendor → Client | base64(JSON `SettleResponse`) |
| `X-PAYMENT-INVALID-REASON` | Vendor → Client | string reason when payment is rejected |

## New Packages

| Package | Added to | Purpose |
|---|---|---|
| `@x402/core` | `packages/sdk`, `examples/vendor-mock`, `apps/api` | Types + base64 serialization |
| `@x402/stellar` | `apps/api` only | `./exact/facilitator` (verify/settle on Stellar blockchain) |

## Components

### 1. Vendor-mock (`examples/vendor-mock`)

**Remove:** `buildServer` returns generic JSON body in 402 response.

**Replace with:** Fastify plugin `x402Payment(opts)` that:

1. On every request, checks for `X-PAYMENT` header.
2. If absent → responds 402 with `X-PAYMENT-REQUIRED` header (base64 of `PaymentRequirements[]`).
3. If present → calls `POST opts.facilitatorUrl + "/verify"` with `{ payload, requirements }`.
   - If `isValid: true` → calls next handler; adds `X-PAYMENT-RESPONSE` to reply.
   - If `isValid: false` → responds 402 + `X-PAYMENT-REQUIRED` + `X-PAYMENT-INVALID-REASON`.
   - If facilitator unreachable → responds 503.

`PaymentRequirements` emitted by vendor-mock:

```typescript
{
  scheme: "exact",
  network: "stellar-testnet",           // "stellar" in mainnet
  maxAmountRequired: "0.005",           // USDC string, not cents
  resource: request.url,
  payTo: opts.vendorWalletPublicKey,    // from env VENDOR_WALLET_PUBLIC_KEY
  asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  facilitatorUrl: opts.facilitatorUrl,  // e.g. "http://localhost:4000"
  maxTimeoutSeconds: 300,
  description: "Market data",
  mimeType: "application/json",
}
```

New env vars for vendor-mock: `VENDOR_WALLET_PUBLIC_KEY`, `AEGIS_FACILITATOR_URL`.

### 2. SDK (`packages/sdk/src/http-402.ts`)

**Remove:** entire file content (`parseHttp402`, `payInvoice`, `parseWwwAuthenticate`, `normalizeInvoice`, `parseAmountToCents`, `Http402Invoice` type).

**Replace with:**

```typescript
// Parse the X-PAYMENT-REQUIRED header from a 402 response
parsePaymentRequired(response: Response): PaymentRequirements[]

// Build the X-PAYMENT header value after Aegis executes the payment
buildPaymentSignature(txHash: string, requirement: PaymentRequirements): string

// High-level: parse → client.pay() → build signature → return header string
payX402(
  client: AegisClient,
  response: Response,
  opts: { vendorId: string; actionType: string; reason?: string; idempotencyKey?: string }
): Promise<{ paymentSignature: string; txHash: string; spendRequestId: string }>
```

**New error class** in `src/lib/errors.ts` (or inline):

```typescript
class X402Error extends Error {
  constructor(
    public readonly code: "missing_payment_required_header"
                        | "invalid_payment_required_format"
                        | "requires_approval"
                        | "payment_execution_failed",
    public readonly detail?: Record<string, unknown>
  ) { ... }
}
```

**Re-exports from `@x402/core`:** `PaymentRequirements`, `PaymentPayload`.

### 3. Aegis API — new route (`apps/api/src/routes/x402.ts`)

Two public endpoints (no agent auth — vendors call these directly):

```
POST /v1/x402/verify
  Body: { payload: PaymentPayload; requirements: PaymentRequirements }
  Response 200: { isValid: boolean; invalidReason: string | null }

POST /v1/x402/settle
  Body: { payload: PaymentPayload; requirements: PaymentRequirements }
  Response 200: { success: boolean; txHash: string; network: string }
```

Implementation delegates to `@x402/stellar/exact/facilitator`:
- `verify(payload, requirements)` — confirms txHash exists on Stellar, correct amount, correct destination
- `settle(payload, requirements)` — marks settlement (may be no-op for Stellar exact scheme)

Rate limiting: apply existing `rate-limit` plugin to these endpoints.
Register route in `apps/api/src/server.ts`.

### 4. Agent example (`examples/claude-agent-402/src/agent.ts`)

**Tool `call_vendor_api`:**
- On 402: returns `{ status: 402, paymentRequiredHeader: response.headers.get("X-PAYMENT-REQUIRED") }` instead of parsing the body.
- On retry: sends `X-PAYMENT: <paymentSignature>` header (not `X-Payment-Proof`).

**Tool `pay_with_aegis`:**
- Input changes: accepts `paymentRequiredHeader: string` (raw base64) instead of `amount_cents + asset + memo`.
- Internally calls `parsePaymentRequired` + `client.pay()` + `buildPaymentSignature`.
- Output adds `paymentSignature: string` alongside `txHash`.

## Error Handling

### Vendor-mock

| Situation | Response |
|---|---|
| `X-PAYMENT` absent | 402 + `X-PAYMENT-REQUIRED` |
| Facilitator returns `isValid: false` | 402 + `X-PAYMENT-REQUIRED` + `X-PAYMENT-INVALID-REASON` |
| Facilitator unreachable | 503 `{ error: "facilitator_unavailable" }` |

### SDK

| Situation | Error |
|---|---|
| `X-PAYMENT-REQUIRED` header absent | `X402Error("missing_payment_required_header")` |
| Invalid base64 or malformed JSON | `X402Error("invalid_payment_required_format")` |
| Aegis returns `REQUIRES_APPROVAL` | `X402Error("requires_approval", { requestId })` — agent stops, instructs human |
| Aegis returns `EXECUTION_FAILED` | `X402Error("payment_execution_failed", { reason })` — no retry |

### Aegis API Facilitator

| Situation | Response |
|---|---|
| txHash not found on Stellar | `{ isValid: false, invalidReason: "transaction_not_found" }` |
| Amount paid < maxAmountRequired | `{ isValid: false, invalidReason: "insufficient_amount" }` |
| Wrong destination | `{ isValid: false, invalidReason: "wrong_destination" }` |
| Malformed request body | 400 Bad Request |

## Testing

### SDK (`packages/sdk/src/__tests__/http-402.test.ts`)
Replace existing tests entirely:
- `parsePaymentRequired` with valid header → returns `PaymentRequirements[]`
- `parsePaymentRequired` with absent header → throws `X402Error("missing_payment_required_header")`
- `parsePaymentRequired` with invalid base64 → throws `X402Error("invalid_payment_required_format")`
- `buildPaymentSignature` → produces decodable base64 with correct fields

### Vendor-mock (`examples/vendor-mock/src/__tests__/server.test.ts`)
Replace existing tests:
- GET `/resource` without `X-PAYMENT` → 402 with decodable `X-PAYMENT-REQUIRED` header
- GET `/resource` with valid `X-PAYMENT` (facilitator mock returns `isValid: true`) → 200 + resource body
- GET `/resource` with invalid `X-PAYMENT` (facilitator mock returns `isValid: false`) → 402 + `X-PAYMENT-INVALID-REASON`

### Aegis API (`apps/api/src/routes/__tests__/x402.test.ts`) — new file
- `POST /v1/x402/verify` with known txHash (Stellar testnet fixture or mock SDK) → `{ isValid: true }`
- `POST /v1/x402/verify` with fake txHash → `{ isValid: false }`
- `POST /v1/x402/settle` happy path

## Files Changed

| File | Action |
|---|---|
| `packages/sdk/package.json` | Add `@x402/core` dependency |
| `packages/sdk/src/http-402.ts` | Replace entirely |
| `packages/sdk/src/__tests__/http-402.test.ts` | Replace entirely |
| `packages/sdk/src/index.ts` | Update exports (remove `Http402Invoice`, add `PaymentRequirements`, `PaymentPayload`, `X402Error`) |
| `packages/sdk/src/types.ts` | Remove `Http402Invoice`, `PayInvoiceOptions` |
| `apps/api/package.json` | Add `@x402/core`, `@x402/stellar` |
| `apps/api/src/routes/x402.ts` | Create new |
| `apps/api/src/server.ts` | Register x402 route |
| `examples/vendor-mock/package.json` | Add `@x402/core` |
| `examples/vendor-mock/src/server.ts` | Replace entirely |
| `examples/vendor-mock/src/__tests__/server.test.ts` | Replace entirely |
| `examples/vendor-mock/.env.example` | Add `VENDOR_WALLET_PUBLIC_KEY`, `AEGIS_FACILITATOR_URL` |
| `examples/claude-agent-402/src/agent.ts` | Update tool definitions and handlers |
