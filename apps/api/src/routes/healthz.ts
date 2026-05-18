/**
 * Health check endpoint — usado por load balancers, monitoramento e CI.
 *
 * Verifica:
 * - DB reachable (SELECT 1)
 * - Versão da app
 * - Network configurado
 *
 * NÃO autenticado.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { env } from '../env.js';

const healthzRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/healthz', async () => {
    let dbStatus: 'ok' | 'error' = 'ok';
    try {
      await app.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      service: 'aegis-api',
      version: '0.0.1',
      network: env.STELLAR_NETWORK,
      treasuryPublicKey: app.stellar.treasuryPublicKey,
      checks: {
        db: dbStatus,
      },
    };
  });
};

export default healthzRoute;
