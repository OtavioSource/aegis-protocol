/**
 * GET /v1/treasury/balances — saldos on-chain da treasury Aegis.
 *
 * Lê USDC + XLM via StellarSettlementAdapter (Horizon). Usado pelo dashboard
 * para exibir o caixa operacional.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { env } from '../env.js';

const treasuryRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/v1/treasury/balances', async (request) => {
    request.requireAgent();

    const [usdc, xlm] = await Promise.all([
      app.stellar.getTreasuryBalance('USDC'),
      app.stellar.getTreasuryBalance('XLM'),
    ]);

    return {
      treasuryPublicKey: app.stellar.treasuryPublicKey,
      network: env.STELLAR_NETWORK,
      balances: [usdc, xlm],
    };
  });
};

export default treasuryRoute;
