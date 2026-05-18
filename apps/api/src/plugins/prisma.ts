/**
 * Fastify plugin: registra um `PrismaClient` único e injeta como `app.prisma`.
 *
 * - Lifecycle: criado no boot, destruído em `onClose`.
 * - Logging: integra com `pino` via `log:` events.
 * - Pooling: confiamos no PgBouncer do Neon (DATABASE_URL pooled).
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

const prismaPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const prisma = new PrismaClient({
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  prisma.$on('warn', (e) => app.log.warn({ prisma: e }, 'prisma warn'));
  prisma.$on('error', (e) => app.log.error({ prisma: e }, 'prisma error'));

  await prisma.$connect();
  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
};

export default fp(prismaPlugin, { name: 'prisma' });
