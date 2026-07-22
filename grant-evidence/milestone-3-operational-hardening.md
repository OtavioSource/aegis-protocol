# Milestone 3 — Operational-Readiness Hardening (API)

> **Evidence: Hardening Features** · Milestone 3 — Admin Dashboard & Operational Hardening
> Scope: `apps/api` (Fastify 5). Each feature below is linked to the source file and includes a
> **verification step** a reviewer can run.

Plugin composition order (`apps/api/src/app.ts`): `error-handler → observability → helmet → cors →
prisma → stellar → etherfuse → auth-agent → rate-limit`, then the routes.

---

## 1. Structured logging
**Where:** `apps/api/src/app.ts` (logger config) · `apps/api/src/server.ts` (`genReqId`) ·
used throughout via `req.log` (e.g. `apps/api/src/plugins/error-handler.ts:23,45,59`).

- Fastify's built-in **pino** structured JSON logger; `pino-pretty` in development, raw JSON in
  production (`env.LOG_LEVEL` controls verbosity).
- **Request correlation:** every request gets an id (`genReqId` honors an incoming `x-request-id`,
  else generates a UUID), echoed back on every response as the `x-request-id` header
  (`plugins/observability.ts:67-70`) and attached to every `req.log` line.

**Verify:**
```bash
pnpm dev          # watch the API logs — each line is structured with reqId, method, url, status
curl -i http://localhost:4000/healthz   # response carries an `x-request-id` header
```

---

## 2. Basic metrics (Prometheus)
**Where:** `apps/api/src/plugins/observability.ts`.

- **prom-client** registry with **default Node.js metrics** (memory, CPU, GC, event-loop lag) via
  `collectDefaultMetrics`.
- Custom instruments:
  - `http_requests_total{method, route, status_code}` — **Counter**.
  - `http_request_duration_seconds{method, route, status_code}` — **Histogram** (buckets
    `0.01…10s`).
- Labels use the **route pattern** (`/v1/spend-requests/:id`), not the raw path, to avoid
  Prometheus cardinality explosion.
- Exposed at **`GET /metrics`** in Prometheus text format.

**Verify:**
```bash
curl http://localhost:4000/metrics
# → http_requests_total{...}, http_request_duration_seconds_bucket{...}, process_*, nodejs_* …
```

---

## 3. Rate limiting
**Where:** `apps/api/src/plugins/rate-limit.ts` · `apps/api/src/app.ts` (`trustProxy: true`) ·
per-route override in `apps/api/src/routes/auth.ts` (login).

- `@fastify/rate-limit`, registered on the **`preHandler` hook** so it runs **after** the
  auth-agent plugin populates `req.agent` — the `keyGenerator` limits **per authenticated agent**
  (`agent:<apiKeyPrefix>`), falling back to **per client IP** for unauthenticated calls.
- **`trustProxy` enabled** so `req.ip` is the real client IP behind the Vercel/proxy layer
  (otherwise every client would collapse into a single global bucket).
- **Stricter per-route limit** on `/v1/auth/login` (10/min per IP) to blunt password brute-force
  against bcrypt.
- Exceeding the limit returns **429** with a `Retry-After`/`retryAfterSeconds` (RFC-7807 shaped by
  the error handler).

> Note: this was hardened in **PR #18** — before it, the limiter ran on `onRequest` (before
> `req.agent` existed) and always fell back to IP; with no `trustProxy` that meant one global
> bucket behind a proxy. See `grant-evidence/../` and the security audit for details.

**Verify:**
```bash
# Hammer a public endpoint past the limit → HTTP 429 with Retry-After
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/v1/auth/login -X POST -H 'content-type: application/json' -d '{"email":"x@x.com","password":"y"}'; done | sort | uniq -c
```

---

## 4. Error tracking / centralized error handling
**Where:** `apps/api/src/plugins/error-handler.ts` · error hierarchy in `apps/api/src/lib/errors.ts`.

- A **global `setErrorHandler`** normalizes every error to **RFC 7807 Problem Details**
  (`application/problem+json`), with a 4-level mapping:
  1. `ApiError` (our typed hierarchy) → correct status + `toProblem()`.
  2. `ZodError` (validation) → 400 with `issues`.
  3. Fastify built-in 4xx (e.g. rate-limit) → preserved status, formatted.
  4. Anything else → **500 generic**, **no stack/internal leak**.
- Every error is **logged structurally** with the request id: `req.log.warn` for expected 4xx,
  `req.log.error({ err })` for unexpected 5xx (full detail server-side only). This is the
  correlation backbone for error tracking (each client-facing error carries the `x-request-id`
  that ties it to the full server log line).

**Verify:**
```bash
# Malformed body → RFC 7807 problem+json, no stack:
curl -i http://localhost:4000/v1/x402/verify -X POST -H 'content-type: application/json' -d '{"bad":"body"}'
# → 400  content-type: application/problem+json  { type, title, status, detail, instance }
```

---

## 5. Bonus — security hardening shipped alongside (PR #18)
Beyond the operational items above, a full **security audit** (`docs/aegis-auditoria-seguranca.md`)
was run and the **critical/high blockers were fixed and merged** (PR #18), covering:
- **RBAC** — human-only session required for approvals & admin routes (an agent can no longer
  approve its own spend or escalate its own limits).
- **x402 anti-replay** — payment proofs are bound to a DB `SpendRequest` and consumed once.
- **Public `/settle`** now requires authentication.
- **Vendor secret** no longer leaked in API responses.
- **Env** — critical secrets require minimum strength and are mandatory in production (fail-fast).

**Verify:** the API test suite (`apps/api/src/routes/__tests__/x402.test.ts` — 12 tests including
replay-rejected and settle-without-auth → 401):
```bash
pnpm --filter @aegis/api test
pnpm --filter @aegis/api typecheck
```

---

### Summary of evidence
| Feature | File | Status |
|---|---|---|
| Structured logging (pino + reqId) | `app.ts`, `plugins/observability.ts` | ✅ |
| Metrics (prom-client, `/metrics`) | `plugins/observability.ts` | ✅ |
| Rate limiting (per-agent + IP, trustProxy, per-route) | `plugins/rate-limit.ts`, `app.ts`, `routes/auth.ts` | ✅ |
| Centralized error handling (RFC 7807, no leak) | `plugins/error-handler.ts`, `lib/errors.ts` | ✅ |
| Security blockers fixed (RBAC, x402 replay, …) | PR #18 | ✅ merged |
