import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from 'fastify-type-provider-zod';

import authAgent from './plugins/auth-agent.js';
import errorHandler from './plugins/error-handler.js';
import etherfusePlugin from './plugins/etherfuse.js';
import observabilityPlugin from './plugins/observability.js';
import prismaPlugin from './plugins/prisma.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import stellarPlugin from './plugins/stellar.js';
import agentsRoute from './routes/agents.js';
import approvalsRoute from './routes/approvals.js';
import auditRoute from './routes/audit.js';
import authRoute from './routes/auth.js';
import companiesRoute from './routes/companies.js';
import fiatRoute from './routes/fiat.js';
import healthz from './routes/healthz.js';
import policiesRoute from './routes/policies.js';
import spendRequestsRoute from './routes/spend-requests.js';
import treasuryRoute from './routes/treasury.js';
import vendorsRoute from './routes/vendors.js';
import walletsRoute from './routes/wallets.js';
import x402Route from './routes/x402.js';
import { env } from './env.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'production'
          ? undefined
          : {
              target: 'pino-pretty',
              options: { translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
            },
    },
    // Respeita um `x-request-id` recebido do cliente (rastreio end-to-end);
    // gera um UUID novo caso o header esteja ausente.
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      if (typeof incoming === 'string' && incoming.length > 0) return incoming;
      return randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandler);
  await app.register(observabilityPlugin);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true });
  await app.register(prismaPlugin);
  await app.register(stellarPlugin);
  await app.register(etherfusePlugin);
  await app.register(authAgent);
  await app.register(rateLimitPlugin);

  await app.register(healthz);
  await app.register(x402Route);
  await app.register(authRoute);
  await app.register(companiesRoute);
  await app.register(treasuryRoute);
  await app.register(agentsRoute);
  await app.register(policiesRoute);
  await app.register(vendorsRoute);
  await app.register(walletsRoute);
  await app.register(spendRequestsRoute);
  await app.register(approvalsRoute);
  await app.register(auditRoute);
  await app.register(fiatRoute);

  await app.ready();
  return app;
}
