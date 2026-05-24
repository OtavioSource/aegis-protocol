import Fastify, { type FastifyInstance } from 'fastify';
import {
  encodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
} from '@x402/core/http';
import type { Network, PaymentRequired, PaymentRequirements, PaymentPayload } from '@x402/core/types';

interface ServerOptions {
  vendorWalletPublicKey: string;
  facilitatorUrl: string;
  logger?: boolean;
}

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  const requirements: PaymentRequirements[] = [
    {
      scheme: 'exact',
      network: 'stellar:testnet' as Network,
      amount: '0.005',
      payTo: opts.vendorWalletPublicKey,
      asset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      maxTimeoutSeconds: 300,
      extra: {
        description: 'Market data',
        mimeType: 'application/json',
        facilitatorUrl: opts.facilitatorUrl,
      },
    },
  ];

  const paymentRequired: PaymentRequired = {
    x402Version: 1,
    resource: {
      url: '/resource',
      description: 'Market data',
      mimeType: 'application/json',
    },
    accepts: requirements,
  };

  const paymentRequiredHeader = encodePaymentRequiredHeader(paymentRequired);

  app.get('/healthz', async () => ({ status: 'ok', vendor: 'mock' }));

  app.get('/resource', async (request, reply) => {
    const paymentHeader = request.headers['x-payment'] as string | undefined;

    if (!paymentHeader) {
      return reply
        .code(402)
        .header('X-PAYMENT-REQUIRED', paymentRequiredHeader)
        .send({ error: 'payment_required' });
    }

    // Decode the X-PAYMENT header to extract payment payload
    let paymentPayload: PaymentPayload;
    try {
      paymentPayload = decodePaymentSignatureHeader(paymentHeader);
    } catch {
      return reply
        .code(402)
        .header('X-PAYMENT-REQUIRED', paymentRequiredHeader)
        .header('X-PAYMENT-INVALID-REASON', 'invalid_payment_header')
        .send({ error: 'invalid_payment_header' });
    }

    // Call facilitator to verify the payment
    let verifyResponse: { isValid: boolean; invalidReason?: string };
    try {
      const res = await fetch(`${opts.facilitatorUrl}/v1/x402/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          x402Version: 1,
          paymentPayload,
          paymentRequirements: requirements[0],
        }),
      });
      if (!res.ok) {
        throw new Error(`facilitator error: ${res.status}`);
      }
      verifyResponse = (await res.json()) as { isValid: boolean; invalidReason?: string };
    } catch {
      return reply.code(503).send({ error: 'facilitator_unavailable' });
    }

    if (!verifyResponse.isValid) {
      return reply
        .code(402)
        .header('X-PAYMENT-REQUIRED', paymentRequiredHeader)
        .header(
          'X-PAYMENT-INVALID-REASON',
          verifyResponse.invalidReason ?? 'verification_failed',
        )
        .send({ error: 'payment_invalid' });
    }

    return reply.code(200).send({
      data: { marketPrice: 42.5, currency: 'USD', timestamp: new Date().toISOString() },
    });
  });

  return app;
}
