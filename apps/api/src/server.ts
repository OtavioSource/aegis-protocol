import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { companiesRoutes } from './routes/companies.js';
import { agentsRoutes } from './routes/agents.js';
import { spendRequestsRoutes } from './routes/spend-requests.js';
import { approvalsRoutes } from './routes/approvals.js';
import { auditRoutes } from './routes/audit.js';
import { prismaPlugin } from './plugins/prisma.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = '0.0.0.0';

export async function buildServer() {
  const isDev = process.env.NODE_ENV !== 'production';
  const app = Fastify({
    logger: isDev
      ? { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true } } }
      : { level: 'info' },
  });

  await app.register(cors, { origin: true });
  await app.register(sensible);
  await app.register(prismaPlugin);

  // Routes
  await app.register(companiesRoutes, { prefix: '/companies' });
  await app.register(agentsRoutes, { prefix: '' });
  await app.register(spendRequestsRoutes, { prefix: '/spend-requests' });
  await app.register(approvalsRoutes, { prefix: '/approvals' });
  await app.register(auditRoutes, { prefix: '' });

  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const app = await buildServer();
  await app.listen({ port: PORT, host: HOST });
  console.log(`CommandRail API running on http://localhost:${PORT}`);
}
