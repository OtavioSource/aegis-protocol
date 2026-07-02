/**
 * x402 facilitator routes — public endpoints for vendors to verify and settle payments.
 *
 * POST /v1/x402/verify  — verify a Stellar payment payload against payment requirements
 * POST /v1/x402/settle  — settle a Stellar payment (sign + submit on-chain)
 *
 * Modelo NÃO-CUSTODIAL (ADR 0007): o pagamento governado pelo Aegis é liquidado
 * pelo fluxo de duas fases `POST /v1/spend-requests` → `/cosign` (agente assina,
 * Aegis co-assina com a aegis key da company). Esse fluxo produz um `txHash`.
 * O agente apresenta esse txHash ao vendor no header X-PAYMENT, e o vendor chama
 * `/verify` aqui — que confere a tx direto no Horizon (caminho "pay-first").
 * A verificação é agnóstica a quem assinou (1 ou 2 chaves), então não muda.
 *
 * O caminho canônico do facilitator (@x402/stellar com a chave operacional do
 * Aegis como signer) permanece para interop x402 genérico — NÃO move fundos de
 * usuário (esses vivem nas carteiras multisig dos donos), apenas a conta
 * operacional do Aegis. Não é o caminho de pagamento governado.
 *
 * PUBLIC — sem auth de agente. Vendors chamam server-side. Rate-limited global.
 */

import { SpendRequestStatus } from '@prisma/client';
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
// Aegis "pay-first" verification helper (anti-replay ancorado no banco)
// ---------------------------------------------------------------------------
// O pagamento governado já foi liquidado on-chain pelo fluxo não-custodial de
// duas fases (spend-request → cosign), que devolveu um txHash ao agente. O
// X-PAYMENT carrega apenas esse txHash.
//
// NÃO validamos só lendo o ledger: o ledger é PÚBLICO — qualquer um leria um
// pagamento histórico ao payTo do vendor e reapresentaria o txHash (replay/forja).
// A fonte de verdade é o BANCO: o txHash tem que corresponder a um SpendRequest
// EXECUTED deste vendor/valor/asset, e a prova é CONSUMIDA atomicamente (uma vez).

async function verifyAndRedeemAegisPayment(
  app: FastifyInstance,
  txHash: string,
  requirements: { asset: string; amount: string; payTo: string },
): Promise<{ isValid: boolean; invalidReason?: string }> {
  const sr = await app.prisma.spendRequest.findFirst({
    where: { txHash },
    include: { vendorWallet: true },
  });
  if (!sr || sr.status !== SpendRequestStatus.EXECUTED) {
    return { isValid: false, invalidReason: 'payment_not_found_or_not_executed' };
  }

  const assetCode = requirements.asset.includes(':')
    ? requirements.asset.split(':')[0]
    : requirements.asset;
  const expectedCents = Math.round(parseFloat(requirements.amount) * 100);

  // Vínculo: destino/valor/asset da fatura têm que bater com o pagamento real.
  if (sr.vendorWallet?.publicKey !== requirements.payTo) {
    return { isValid: false, invalidReason: 'payto_mismatch' };
  }
  if (Number(sr.amountCents) !== expectedCents) {
    return { isValid: false, invalidReason: 'amount_mismatch' };
  }
  if (sr.asset !== assetCode) {
    return { isValid: false, invalidReason: 'asset_mismatch' };
  }

  // Anti-replay: consome a prova atomicamente (o filtro x402RedeemedAt=null +
  // updateMany garante que corridas concorrentes só resgatem uma vez).
  const claimed = await app.prisma.spendRequest.updateMany({
    where: { id: sr.id, x402RedeemedAt: null },
    data: { x402RedeemedAt: new Date() },
  });
  if (claimed.count === 0) {
    return { isValid: false, invalidReason: 'proof_already_redeemed' };
  }
  return { isValid: true };
}

function extractAegisTxHash(payload: unknown): string | null {
  const inner = (payload as { payload?: unknown })?.payload;
  const tx = (inner as { transaction?: unknown })?.transaction;
  if (typeof tx === 'string' && /^[a-f0-9]{64}$/i.test(tx)) return tx;
  return null;
}

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

    // Aegis "pay-first" path: payload carrega o txHash de uma tx já liquidada
    // pelo próprio Aegis — valida contra o banco + consome a prova (anti-replay).
    const aegisTxHash = extractAegisTxHash(body.payload);
    if (aegisTxHash) {
      const result = await verifyAndRedeemAegisPayment(app, aegisTxHash, body.requirements);
      return reply.send(result);
    }

    // Caminho canônico x402-stellar (cliente submete via facilitator.settle)
    try {
      const fac = getFacilitator();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fac.verify(body.payload as any, body.requirements as any);
      return reply.send(result);
    } catch (err) {
      // Endpoint público: não devolver String(err) (vaza Horizon/RPC/SDK internals).
      app.log.error({ err }, 'x402 verify error');
      return reply.code(400).send({ error: 'verification_failed' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /v1/x402/settle
  // -------------------------------------------------------------------------
  app.post('/v1/x402/settle', async (request, reply) => {
    // settle assina/submete com a chave operacional da treasury — NÃO pode ser
    // público (griefing/gasto de fee). Exige agente autenticado da plataforma.
    request.requireAgent();

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'invalid_request', detail: err.issues });
      }
      return reply.code(400).send({ error: 'invalid_request' });
    }

    try {
      const fac = getFacilitator();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fac.settle(body.payload as any, body.requirements as any);
      return reply.send(result);
    } catch (err) {
      app.log.error({ err }, 'x402 settle error');
      return reply.code(400).send({ error: 'settle_failed' });
    }
  });
};

export default x402Route;
