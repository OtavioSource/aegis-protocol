/**
 * x402 facilitator routes — public endpoints for vendors to verify and settle payments.
 *
 * POST /v1/x402/verify  — verify a Stellar payment payload against payment requirements
 * POST /v1/x402/settle  — settle a Stellar payment (sign + submit on-chain)
 *
 * These endpoints delegate to @x402/stellar ExactStellarScheme (facilitator).
 * They are PUBLIC — no agent auth required. Vendors call them server-side.
 * Rate-limited via the global rate-limit plugin registered in server.ts.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/facilitator';

import { env } from '../env.js';

// ---------------------------------------------------------------------------
// Request body schema
// ---------------------------------------------------------------------------
// We accept the raw x402 payload and requirements as-is, using passthrough
// so the facilitator receives all fields it expects without strict validation here.

const PaymentPayloadSchema = z
  .object({
    x402Version: z.number(),
    scheme: z.string(),
    network: z.string(),
    payload: z.record(z.unknown()),
    accepted: z
      .object({
        scheme: z.string(),
        network: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

const PaymentRequirementsSchema = z
  .object({
    scheme: z.string(),
    network: z.string(),
    payTo: z.string(),
    amount: z.string(),
    asset: z.string(),
  })
  .passthrough();

const BodySchema = z.object({
  payload: PaymentPayloadSchema,
  requirements: PaymentRequirementsSchema,
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const x402Route: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Lazily create the facilitator instance.
  // If TREASURY_SECRET is absent (e.g. in tests) we still allow the route to
  // be registered — missing config will surface at request time.
  let facilitator: ExactStellarScheme | null = null;

  function getFacilitator(): ExactStellarScheme {
    if (facilitator) return facilitator;

    if (!env.TREASURY_SECRET) {
      throw new Error('TREASURY_SECRET is required for x402 facilitator routes');
    }

    const signer = createEd25519Signer(
      env.TREASURY_SECRET,
      // CAIP-2 network identifier — align with STELLAR_NETWORK env
      env.STELLAR_NETWORK === 'mainnet' ? 'stellar:pubnet' : 'stellar:testnet',
    );

    facilitator = new ExactStellarScheme([signer], {
      rpcConfig: { url: env.SOROBAN_RPC_URL },
    });

    return facilitator;
  }

  // -------------------------------------------------------------------------
  // POST /v1/x402/verify
  // -------------------------------------------------------------------------
  app.post('/v1/x402/verify', async (request, reply) => {
    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'invalid_request', detail: err.issues });
      }
      return reply.code(400).send({ error: 'invalid_request', detail: String(err) });
    }

    try {
      const fac = getFacilitator();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fac.verify(body.payload as any, body.requirements as any);
      return reply.send(result);
    } catch (err) {
      app.log.error({ err }, 'x402 verify error');
      return reply.code(400).send({ error: 'verification_failed', detail: String(err) });
    }
  });

  // -------------------------------------------------------------------------
  // POST /v1/x402/settle
  // -------------------------------------------------------------------------
  app.post('/v1/x402/settle', async (request, reply) => {
    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'invalid_request', detail: err.issues });
      }
      return reply.code(400).send({ error: 'invalid_request', detail: String(err) });
    }

    try {
      const fac = getFacilitator();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fac.settle(body.payload as any, body.requirements as any);
      return reply.send(result);
    } catch (err) {
      app.log.error({ err }, 'x402 settle error');
      return reply.code(400).send({ error: 'settle_failed', detail: String(err) });
    }
  });
};

export default x402Route;
