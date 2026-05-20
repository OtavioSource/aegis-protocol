/**
 * Fastify plugin: registra um `EtherfuseClient` quando `ETHERFUSE_API_KEY` está
 * configurada. Caso contrário, `app.etherfuse = null` — rotas Etherfuse
 * retornam 503 Service Unavailable.
 *
 * Plugin é OPCIONAL — diferente do StellarSettlementAdapter (treasury é
 * obrigatória), Etherfuse é só um anchor a mais (SEP-24 ainda funciona).
 */

import { EtherfuseClient } from '@aegis/stellar';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { env } from '../env.js';

declare module 'fastify' {
  interface FastifyInstance {
    etherfuse: EtherfuseClient | null;
    etherfuseCustomerId: string | null;
    etherfuseBankAccountId: string | null;
  }
}

const etherfusePlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  if (!env.ETHERFUSE_API_KEY) {
    app.decorate('etherfuse', null);
    app.decorate('etherfuseCustomerId', null);
    app.decorate('etherfuseBankAccountId', null);
    app.log.info('Etherfuse: ETHERFUSE_API_KEY ausente — anchor Etherfuse desabilitado');
    return;
  }

  const client = new EtherfuseClient({
    baseUrl: env.ETHERFUSE_BASE_URL,
    apiKey: env.ETHERFUSE_API_KEY,
  });

  app.decorate('etherfuse', client);
  app.decorate('etherfuseCustomerId', env.ETHERFUSE_CUSTOMER_ID ?? null);
  app.decorate('etherfuseBankAccountId', env.ETHERFUSE_BANK_ACCOUNT_ID ?? null);
  app.log.info(
    { baseUrl: env.ETHERFUSE_BASE_URL, sandbox: client.isSandbox },
    'EtherfuseClient ready',
  );
};

export default fp(etherfusePlugin, { name: 'etherfuse' });
