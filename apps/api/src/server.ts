/**
 * @file server.ts
 * @package apps/api
 *
 * ═══════════════════════════════════════════════════════════════
 *  FASTIFY SERVER — ENTRY POINT AND COMPOSITION ROOT
 * ═══════════════════════════════════════════════════════════════
 *
 * This file is the application's composition root: it wires together
 * all plugins, middleware, and route modules into a runnable server.
 *
 * Architecture decisions:
 *
 *   1. `import 'dotenv/config'` MUST be the first import.
 *      Packages like @aegis/solana read `process.env['SOLANA_RPC_URL']`
 *      at import time. If dotenv hasn't run yet, they get undefined and fall
 *      back to public devnet — even when running against a local validator.
 *
 *   2. `buildServer()` is exported separately from the auto-start block.
 *      This enables clean testing: test files import buildServer() without
 *      triggering the listen() call, keeping tests fast and port-conflict-free.
 *
 *   3. Fastify over Express: built-in schema validation, faster JSON parsing,
 *      plugin encapsulation model, and native TypeScript generics on routes.
 *
 *   4. @fastify/sensible adds convenience reply methods like reply.notFound(),
 *      reply.badRequest(), reply.unauthorized(), etc., keeping route handlers clean.
 *
 *   5. Prisma is registered as a plugin (see plugins/prisma.ts) so it's
 *      available as `app.prisma` and `request.server.prisma` everywhere.
 *      The plugin handles lifecycle (connect on startup, disconnect on shutdown).
 *
 * Route structure:
 *   /companies/**          → companiesRoutes (tenants + treasuries)
 *   /companies/:id/agents  → agentsRoutes (agent CRUD)
 *   /agents/**             → agentsRoutes (kill switch, policies, budgets, audit)
 *   /spend-requests/**     → spendRequestsRoutes (THE CORE FLOW)
 *   /approvals/**          → approvalsRoutes (human review queue)
 *   /companies/:id/audit-logs → auditRoutes
 *   /health                → healthcheck (used by Railway deploy)
 */

// IMPORTANT: dotenv must load before any other local import reads process.env
import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { companiesRoutes } from './routes/companies.js';
import { agentsRoutes } from './routes/agents.js';
import { spendRequestsRoutes } from './routes/spend-requests.js';
import { approvalsRoutes } from './routes/approvals.js';
import { auditRoutes } from './routes/audit.js';
import { vendorsRoutes } from './routes/vendors.js';
import { usersRoutes } from './routes/users.js';
import { prismaPlugin } from './plugins/prisma.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = '0.0.0.0'; // Listen on all interfaces for Docker/Railway compatibility

/**
 * buildServer() — construct and configure the Fastify app.
 *
 * Exported so tests can import it without triggering listen().
 * In production (NODE_ENV !== 'test'), the bottom of this file
 * calls buildServer() and starts listening automatically.
 */
export async function buildServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  const app = Fastify({
    // Pretty-print logs in development, structured JSON in production
    logger: isDev
      ? { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true } } }
      : { level: 'info' },
  });

  // CORS — permissive for now; tighten to specific origins before mainnet
  await app.register(cors, { origin: true });

  // Sensible HTTP helpers: reply.notFound(), reply.badRequest(), etc.
  await app.register(sensible);

  // Prisma client — available as app.prisma and request.server.prisma
  await app.register(prismaPlugin);

  // ─── Route Modules ───────────────────────────────────────────────────────
  // Ordered by dependency: companies must exist before agents,
  // agents before spend requests, spend requests before approvals.

  // Company + treasury management (admin operations)
  await app.register(companiesRoutes, { prefix: '/companies' });

  // Agent CRUD, kill switch, policies, budgets
  // No prefix: routes are /companies/:id/agents AND /agents/:id (mixed)
  await app.register(agentsRoutes, { prefix: '' });

  // THE CORE: spend request submission, evaluation, and Solana execution
  await app.register(spendRequestsRoutes, { prefix: '/spend-requests' });

  // Human approval queue: approve/reject REQUIRES_APPROVAL requests
  await app.register(approvalsRoutes, { prefix: '/approvals' });

  // Audit log query (immutable event trail)
  await app.register(auditRoutes, { prefix: '' });

  // Vendor registry — real Solana wallet addresses for payment recipients
  await app.register(vendorsRoutes, { prefix: '' });

  // Admin user management + login endpoint for NextAuth
  await app.register(usersRoutes, { prefix: '' });

  // Health check endpoint — polled by Railway to determine deploy success
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  return app;
}

// ─── Auto-start (non-test environments) ──────────────────────────────────────
// In test mode, the test runner imports buildServer() directly and manages
// the server lifecycle. This block only runs via `pnpm start` / `pnpm dev`.
if (process.env.NODE_ENV !== 'test') {
  const app = await buildServer();
  await app.listen({ port: PORT, host: HOST });
  console.log(`Aegis Protocol API running on http://localhost:${PORT}`);
}
