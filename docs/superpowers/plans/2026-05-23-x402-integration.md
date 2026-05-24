# x402 Protocol Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic HTTP 402 implementation with full x402 protocol compliance. Four components change: SDK (`packages/sdk`), vendor-mock (`examples/vendor-mock`), Aegis API (new facilitator routes), and the Claude agent example (`examples/claude-agent-402`).

**Design spec:** `docs/superpowers/specs/2026-05-23-x402-integration-design.md` — read it before starting.

**Tech Stack:** TypeScript 5.7, Node 22, `@x402/core`, `@x402/stellar`, `@anthropic-ai/sdk`, Fastify, Vitest

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/sdk/package.json` | Add `@x402/core` dependency |
| Replace | `packages/sdk/src/http-402.ts` | x402-compliant parse/build/pay helpers |
| Replace | `packages/sdk/src/__tests__/http-402.test.ts` | Tests for new helpers |
| Modify | `packages/sdk/src/index.ts` | Update exports |
| Modify | `packages/sdk/src/types.ts` | Remove `Http402Invoice`, `PayInvoiceOptions` |
| Modify | `apps/api/package.json` | Add `@x402/core`, `@x402/stellar` |
| Create | `apps/api/src/routes/x402.ts` | Facilitator endpoints `/v1/x402/verify` and `/v1/x402/settle` |
| Modify | `apps/api/src/server.ts` | Register x402 routes |
| Create | `apps/api/src/routes/__tests__/x402.test.ts` | Tests for facilitator endpoints |
| Modify | `examples/vendor-mock/package.json` | Add `@x402/core` |
| Replace | `examples/vendor-mock/src/server.ts` | x402 Fastify plugin |
| Replace | `examples/vendor-mock/src/__tests__/server.test.ts` | Tests for x402 vendor-mock |
| Modify | `examples/vendor-mock/.env.example` | Add `VENDOR_WALLET_PUBLIC_KEY`, `AEGIS_FACILITATOR_URL` |
| Modify | `examples/claude-agent-402/src/agent.ts` | Update tool definitions and handlers |

---

## Task 1: SDK — Replace `http-402.ts`

**Objective:** Remove the multi-format generic parser. Implement three focused functions that speak x402 natively.

### Step 1.1 — Add `@x402/core` to SDK package.json

- [ ] In `packages/sdk/package.json`, add `"@x402/core": "^0.1.0"` to `dependencies`.

### Step 1.2 — Remove legacy types from `types.ts`

- [ ] In `packages/sdk/src/types.ts`, remove the `Http402Invoice` interface and the `PayInvoiceOptions` type.
- [ ] Do NOT remove `PayResult` — it is still used by `payX402`.

### Step 1.3 — Rewrite `http-402.ts`

Delete all existing content. Write:

```typescript
import { decodeXPaymentRequired, encodeXPayment } from '@x402/core';
import type { PaymentPayload, PaymentRequirements } from '@x402/core';
import type { AegisClient } from './client.js';

export type { PaymentRequirements, PaymentPayload };

export class X402Error extends Error {
  constructor(
    public readonly code:
      | 'missing_payment_required_header'
      | 'invalid_payment_required_format'
      | 'requires_approval'
      | 'payment_execution_failed',
    public readonly detail?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'X402Error';
  }
}

export function parsePaymentRequired(response: Response): PaymentRequirements[] {
  const header = response.headers.get('X-PAYMENT-REQUIRED');
  if (!header) throw new X402Error('missing_payment_required_header');
  try {
    return decodeXPaymentRequired(header);
  } catch {
    throw new X402Error('invalid_payment_required_format');
  }
}

export function buildPaymentSignature(
  txHash: string,
  requirement: PaymentRequirements,
): string {
  const payload: PaymentPayload = {
    scheme: requirement.scheme,
    network: requirement.network,
    payload: { transaction: txHash },
  };
  return encodeXPayment(payload);
}

export async function payX402(
  client: AegisClient,
  response: Response,
  opts: {
    vendorId: string;
    actionType: string;
    reason?: string;
    idempotencyKey?: string;
  },
): Promise<{ paymentSignature: string; txHash: string; spendRequestId: string }> {
  const requirements = parsePaymentRequired(response);
  const req = requirements.find((r) => r.scheme === 'exact') ?? requirements[0];
  if (!req) throw new X402Error('invalid_payment_required_format');

  const result = await client.pay({
    vendorId: opts.vendorId,
    actionType: opts.actionType,
    reason: opts.reason,
    idempotencyKey: opts.idempotencyKey,
    amount: req.maxAmountRequired,
    asset: req.asset,
    to: req.payTo,
    network: req.network,
  });

  if (result.status === 'REQUIRES_APPROVAL') {
    throw new X402Error('requires_approval', { requestId: result.spendRequestId });
  }
  if (result.status !== 'EXECUTED') {
    throw new X402Error('payment_execution_failed', { reason: result.failureReason });
  }

  return {
    paymentSignature: buildPaymentSignature(result.txHash, req),
    txHash: result.txHash,
    spendRequestId: result.spendRequestId,
  };
}
```

**Note:** `decodeXPaymentRequired` and `encodeXPayment` are the actual export names from `@x402/core` — verify against the installed package before writing. If names differ, use the correct names.

### Step 1.4 — Update `index.ts` exports

- [ ] Remove: `parseHttp402`, `payInvoice`, `Http402Invoice`, `PayInvoiceOptions`
- [ ] Add: `parsePaymentRequired`, `buildPaymentSignature`, `payX402`, `X402Error`, `PaymentRequirements`, `PaymentPayload`

### Step 1.5 — Replace SDK tests

File: `packages/sdk/src/__tests__/http-402.test.ts` — replace entirely:

```typescript
import { describe, expect, it } from 'vitest';
import { buildPaymentSignature, parsePaymentRequired, X402Error } from '../http-402.js';
import { encodeXPaymentRequired } from '@x402/core';

const mockRequirement = {
  scheme: 'exact',
  network: 'stellar-testnet',
  maxAmountRequired: '0.005',
  resource: '/resource',
  payTo: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKFY7STD6J4WT0PJDID2R',
  asset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  facilitatorUrl: 'http://localhost:4000',
  maxTimeoutSeconds: 300,
  description: 'Market data',
  mimeType: 'application/json',
};

function makeResponse402(header?: string): Response {
  return new Response(null, {
    status: 402,
    headers: header ? { 'X-PAYMENT-REQUIRED': header } : {},
  });
}

describe('parsePaymentRequired', () => {
  it('returns requirements from valid header', () => {
    const encoded = encodeXPaymentRequired([mockRequirement]);
    const result = parsePaymentRequired(makeResponse402(encoded));
    expect(result).toHaveLength(1);
    expect(result[0].scheme).toBe('exact');
  });

  it('throws missing_payment_required_header when header absent', () => {
    expect(() => parsePaymentRequired(makeResponse402())).toThrow(
      expect.objectContaining({ code: 'missing_payment_required_header' }),
    );
  });

  it('throws invalid_payment_required_format on bad base64', () => {
    expect(() => parsePaymentRequired(makeResponse402('not-valid-base64!!!'))).toThrow(
      expect.objectContaining({ code: 'invalid_payment_required_format' }),
    );
  });
});

describe('buildPaymentSignature', () => {
  it('returns decodable base64 with transaction field', () => {
    const sig = buildPaymentSignature('abc123txhash', mockRequirement);
    expect(typeof sig).toBe('string');
    const decoded = JSON.parse(Buffer.from(sig, 'base64').toString());
    expect(decoded.payload.transaction).toBe('abc123txhash');
  });
});
```

---

## Task 2: Vendor-Mock — Rewrite as x402 plugin

**Objective:** Replace custom 402 body logic with a Fastify plugin that emits `X-PAYMENT-REQUIRED` and validates `X-PAYMENT` via the Aegis facilitator.

### Step 2.1 — Add `@x402/core` to vendor-mock package.json

- [ ] In `examples/vendor-mock/package.json`, add `"@x402/core": "^0.1.0"` to `dependencies`.

### Step 2.2 — Update `.env.example`

- [ ] In `examples/vendor-mock/.env.example`, add:

```
VENDOR_WALLET_PUBLIC_KEY=
AEGIS_FACILITATOR_URL=http://localhost:4000
```

### Step 2.3 — Rewrite `server.ts`

Replace entirely. The server must expose the Fastify app factory (no side effects) so tests can inject requests:

```typescript
import Fastify, { type FastifyInstance } from 'fastify';
import { decodeXPayment, encodeXPaymentRequired } from '@x402/core';
import type { PaymentRequirements } from '@x402/core';

interface ServerOptions {
  vendorWalletPublicKey: string;
  facilitatorUrl: string;
  port?: number;
}

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });

  const requirement: PaymentRequirements = {
    scheme: 'exact',
    network: 'stellar-testnet',
    maxAmountRequired: '0.005',
    resource: '/resource',
    payTo: opts.vendorWalletPublicKey,
    asset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    facilitatorUrl: opts.facilitatorUrl,
    maxTimeoutSeconds: 300,
    description: 'Market data',
    mimeType: 'application/json',
  };

  app.get('/resource', async (request, reply) => {
    const paymentHeader = request.headers['x-payment'] as string | undefined;

    if (!paymentHeader) {
      return reply
        .code(402)
        .header('X-PAYMENT-REQUIRED', encodeXPaymentRequired([requirement]))
        .send({ error: 'payment_required' });
    }

    // Verify via Aegis facilitator
    let verifyResult: { isValid: boolean; invalidReason: string | null };
    try {
      const payload = decodeXPayment(paymentHeader);
      const res = await fetch(`${opts.facilitatorUrl}/v1/x402/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload, requirements: requirement }),
      });
      verifyResult = (await res.json()) as typeof verifyResult;
    } catch {
      return reply.code(503).send({ error: 'facilitator_unavailable' });
    }

    if (!verifyResult.isValid) {
      return reply
        .code(402)
        .header('X-PAYMENT-REQUIRED', encodeXPaymentRequired([requirement]))
        .header('X-PAYMENT-INVALID-REASON', verifyResult.invalidReason ?? 'invalid')
        .send({ error: 'payment_invalid' });
    }

    return reply.send({
      data: { market: 'BTC/USDC', price: 67_420, timestamp: Date.now() },
    });
  });

  return app;
}
```

### Step 2.4 — Replace vendor-mock tests

File: `examples/vendor-mock/src/__tests__/server.test.ts` — replace entirely:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../server.js';
import { encodeXPaymentRequired, encodeXPayment } from '@x402/core';

const opts = {
  vendorWalletPublicKey: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKFY7STD6J4WT0PJDID2R',
  facilitatorUrl: 'http://localhost:4000',
};

describe('vendor-mock x402', () => {
  it('returns 402 with X-PAYMENT-REQUIRED when no payment header', async () => {
    const app = buildServer(opts);
    const res = await app.inject({ method: 'GET', url: '/resource' });
    expect(res.statusCode).toBe(402);
    const header = res.headers['x-payment-required'];
    expect(typeof header).toBe('string');
    // must be decodable
    const decoded = JSON.parse(Buffer.from(header as string, 'base64').toString());
    expect(decoded[0].scheme).toBe('exact');
  });

  it('returns 200 when facilitator returns isValid:true', async () => {
    vi.stubGlobal('fetch', async () => ({
      json: async () => ({ isValid: true, invalidReason: null }),
    }));
    const app = buildServer(opts);
    const paymentHeader = 'valid-mock-header';
    const res = await app.inject({
      method: 'GET',
      url: '/resource',
      headers: { 'x-payment': paymentHeader },
    });
    expect(res.statusCode).toBe(200);
    vi.unstubAllGlobals();
  });

  it('returns 402 with invalid reason when facilitator returns isValid:false', async () => {
    vi.stubGlobal('fetch', async () => ({
      json: async () => ({ isValid: false, invalidReason: 'transaction_not_found' }),
    }));
    const app = buildServer(opts);
    const res = await app.inject({
      method: 'GET',
      url: '/resource',
      headers: { 'x-payment': 'bad-header' },
    });
    expect(res.statusCode).toBe(402);
    expect(res.headers['x-payment-invalid-reason']).toBe('transaction_not_found');
    vi.unstubAllGlobals();
  });

  it('returns 503 when facilitator is unreachable', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('ECONNREFUSED'); });
    const app = buildServer(opts);
    const res = await app.inject({
      method: 'GET',
      url: '/resource',
      headers: { 'x-payment': 'any-header' },
    });
    expect(res.statusCode).toBe(503);
    vi.unstubAllGlobals();
  });
});
```

---

## Task 3: Aegis API — Facilitator Routes

**Objective:** Add `POST /v1/x402/verify` and `POST /v1/x402/settle` using `@x402/stellar/exact/facilitator`.

### Step 3.1 — Add dependencies to API package.json

- [ ] In `apps/api/package.json`, add to `dependencies`:
  - `"@x402/core": "^0.1.0"`
  - `"@x402/stellar": "^0.1.0"`

### Step 3.2 — Create `apps/api/src/routes/x402.ts`

```typescript
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { verify, settle } from '@x402/stellar/exact/facilitator';

const PaymentPayloadSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  payload: z.object({ transaction: z.string() }),
});

const PaymentRequirementsSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  maxAmountRequired: z.string(),
  resource: z.string(),
  payTo: z.string(),
  asset: z.string(),
  facilitatorUrl: z.string(),
  maxTimeoutSeconds: z.number(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});

const BodySchema = z.object({
  payload: PaymentPayloadSchema,
  requirements: PaymentRequirementsSchema,
});

export const x402Routes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/v1/x402/verify',
    { schema: { body: BodySchema } },
    async (request, reply) => {
      const { payload, requirements } = request.body;
      try {
        const result = await verify(payload as any, requirements as any);
        return reply.send(result);
      } catch (err) {
        return reply.code(400).send({ error: 'verification_failed', detail: String(err) });
      }
    },
  );

  app.post(
    '/v1/x402/settle',
    { schema: { body: BodySchema } },
    async (request, reply) => {
      const { payload, requirements } = request.body;
      try {
        const result = await settle(payload as any, requirements as any);
        return reply.send(result);
      } catch (err) {
        return reply.code(400).send({ error: 'settle_failed', detail: String(err) });
      }
    },
  );
};
```

**Note:** The actual import path `@x402/stellar/exact/facilitator` must be verified against the package after install. It may be `@x402/stellar` with named exports `verifyExact` / `settleExact`. Check before writing.

### Step 3.3 — Register x402 routes in `apps/api/src/server.ts`

- [ ] Import `x402Routes` from `./routes/x402.js`.
- [ ] Register: `await app.register(x402Routes)` — add alongside existing route registrations. No auth plugin on these routes (vendors call them directly).

### Step 3.4 — Create API tests

File: `apps/api/src/routes/__tests__/x402.test.ts` — new file:

```typescript
import { describe, expect, it, vi } from 'vitest';
// import the test server builder — check how other route tests do it in this project

describe('POST /v1/x402/verify', () => {
  it('returns { isValid: true } for a valid transaction', async () => {
    // mock @x402/stellar/exact/facilitator.verify to return { isValid: true }
    // inject POST /v1/x402/verify with a valid payload
    // assert 200 + { isValid: true, invalidReason: null }
  });

  it('returns { isValid: false } for unknown transaction', async () => {
    // mock verify to return { isValid: false, invalidReason: 'transaction_not_found' }
    // assert 200 + { isValid: false }
  });

  it('returns 400 on malformed body', async () => {
    // inject with missing required fields
    // assert 400
  });
});

describe('POST /v1/x402/settle', () => {
  it('returns success on happy path', async () => {
    // mock settle to return { success: true, txHash: 'abc', network: 'stellar-testnet' }
  });
});
```

**Implementation note:** Look at how existing route tests are structured (e.g., `apps/api/src/routes/__tests__/spend-requests.test.ts`) before writing this file — follow the same pattern for building the test server.

---

## Task 4: Agent Example — Update tool definitions

**Objective:** Update `examples/claude-agent-402/src/agent.ts` to use `X-PAYMENT` / `X-PAYMENT-REQUIRED` headers instead of `X-Payment-Proof` / JSON body parsing.

### Step 4.1 — Update `call_vendor_api` tool

- [ ] On 402 response: return `{ status: 402, paymentRequiredHeader: response.headers.get('X-PAYMENT-REQUIRED') }` — not the body.
- [ ] On retry (when called with `paymentSignature`): add header `X-PAYMENT: <paymentSignature>` instead of `X-Payment-Proof`.

### Step 4.2 — Update `pay_with_aegis` tool

- [ ] Input: accept `paymentRequiredHeader: string` (raw base64) instead of `amount_cents + asset + memo`.
- [ ] Internally call `parsePaymentRequired` from SDK, then `client.pay()`, then `buildPaymentSignature`.
- [ ] Output: return `{ paymentSignature, txHash, spendRequestId }` — agent uses `paymentSignature` in next `call_vendor_api` call.

### Step 4.3 — Update system prompt / tool descriptions

- [ ] Update tool descriptions in Claude tool_use definition to reflect new parameter names.
- [ ] Ensure the agent loop handles `X402Error('requires_approval')` by stopping and informing the user.

---

## Task 5: Verification

Run in order:

- [ ] `pnpm --filter @aegis/sdk typecheck` — no errors
- [ ] `pnpm --filter @aegis/sdk test` — all pass
- [ ] `pnpm --filter vendor-mock typecheck` — no errors
- [ ] `pnpm --filter vendor-mock test` — all pass
- [ ] `pnpm --filter @aegis/api typecheck` — no errors
- [ ] `pnpm --filter @aegis/api test` — new x402 tests pass
- [ ] End-to-end smoke test (optional, requires testnet): run vendor-mock + API + agent, observe full flow in terminal

---

## Constraints

- Do NOT use `@x402/fastify` middleware — it bypasses Aegis governance (policy eval, human approval, Soroban audit).
- The facilitator routes (`/v1/x402/verify`, `/v1/x402/settle`) must NOT require agent auth — vendors call them directly.
- Verify all `@x402/*` export names against the installed package before writing — the npm packages were new as of early 2025 and names may differ from spec.
- Rate-limit the facilitator endpoints using whichever rate-limit plugin is already configured in `apps/api/src/server.ts`.
