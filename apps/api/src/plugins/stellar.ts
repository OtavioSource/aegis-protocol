/**
 * Fastify plugin que instancia o StellarSettlementAdapter e decora `app.stellar`.
 *
 * - Boot-time fail-fast: se TREASURY_SECRET ou VENDOR_KEY_ENCRYPTION_KEY
 *   estiverem ausentes/inválidos, processo morre antes de aceitar requests.
 * - Singleton: 1 adapter por processo (treasury é singleton no MVP).
 */

import { StellarSettlementAdapter } from '@aegis/stellar';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { env } from '../env.js';

declare module 'fastify' {
  interface FastifyInstance {
    stellar: StellarSettlementAdapter;
  }
}

const stellarPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  if (!env.TREASURY_SECRET) {
    throw new Error(
      'TREASURY_SECRET não configurado. Rode `pnpm --filter @aegis/api setup:treasury` ' +
        'para gerar e configurar a treasury em testnet.',
    );
  }
  if (!env.VENDOR_KEY_ENCRYPTION_KEY) {
    throw new Error(
      'VENDOR_KEY_ENCRYPTION_KEY não configurado. Veja apps/api/.env.example ou rode ' +
        '`node -e "console.log(crypto.randomBytes(32).toString(\\"hex\\"))"` para gerar.',
    );
  }

  const adapter = new StellarSettlementAdapter({
    network: env.STELLAR_NETWORK,
    horizonUrl: env.STELLAR_HORIZON_URL,
    treasurySecret: env.TREASURY_SECRET,
    anchorDomain: env.SEP24_ANCHOR_HOME_DOMAIN,
  });

  app.decorate('stellar', adapter);
  app.log.info(
    { treasuryPublicKey: adapter.treasuryPublicKey, network: env.STELLAR_NETWORK },
    'StellarSettlementAdapter ready',
  );
};

export default fp(stellarPlugin, { name: 'stellar' });
