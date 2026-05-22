import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

interface ServerOptions {
  priceCents: number;
  asset: string;
  logger?: boolean;
}

const TX_HASH_REGEX = /^[a-f0-9]{64}$/i;

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.get('/healthz', async () => ({ status: 'ok', vendor: 'mock' }));

  app.get('/resource', async (request, reply) => {
    const proof = (request.headers['x-payment-proof'] as string | undefined) ?? '';

    if (TX_HASH_REGEX.test(proof)) {
      return reply.code(200).send({
        data: { marketPrice: 42.5, currency: 'USD', timestamp: new Date().toISOString() },
        paymentProofReceived: proof,
      });
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    return reply.code(402).send({
      amount: opts.priceCents / 100,
      asset: opts.asset,
      to: 'GVENDORMOCKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      memo: `invoice-${randomUUID().slice(0, 8)}`,
      network: 'stellar-testnet',
      expires_at: expiresAt,
    });
  });

  return app;
}
