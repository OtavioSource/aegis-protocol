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

  // /healthz/deep — verifica dependências externas (Soroban RPC, Horizon).
  // 503 quando alguma cair, 200 quando todas ok. NÃO use para liveness — use
  // o /healthz raso para isso (mais barato e tolera blip de dependência).
  app.get('/healthz/deep', async (_req, reply) => {
    const checks = await Promise.all([
      checkDb(app),
      checkUrl(env.SOROBAN_RPC_URL, 'soroban-rpc'),
      checkUrl(env.STELLAR_HORIZON_URL, 'horizon'),
    ]);
    const status = checks.every((c) => c.status === 'ok') ? 'ok' : 'degraded';
    reply.code(status === 'ok' ? 200 : 503);
    return {
      status,
      service: 'aegis-api',
      version: '0.0.1',
      network: env.STELLAR_NETWORK,
      treasuryPublicKey: app.stellar.treasuryPublicKey,
      checks: Object.fromEntries(checks.map((c) => [c.name, c.status])),
    };
  });
};

async function checkDb(app: FastifyInstance): Promise<{ name: string; status: 'ok' | 'error' }> {
  try {
    await app.prisma.$queryRaw`SELECT 1`;
    return { name: 'db', status: 'ok' };
  } catch {
    return { name: 'db', status: 'error' };
  }
}

async function checkUrl(
  url: string,
  name: string,
): Promise<{ name: string; status: 'ok' | 'error' }> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(t);
    // Horizon devolve 200 na raiz; Soroban RPC sem body é POST-only e devolve
    // 4xx em GET mas significa "servidor vivo". Qualquer resposta <500 conta.
    return { name, status: res.status < 500 ? 'ok' : 'error' };
  } catch {
    return { name, status: 'error' };
  }
}

export default healthzRoute;
