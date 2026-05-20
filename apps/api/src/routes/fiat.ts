/**
 * Rotas /v1/fiat/* — gestão de deposits via múltiplos anchors.
 *
 * - POST /v1/fiat/deposits              — inicia deposit. body.provider seleciona anchor:
 *                                          "sep24" (default) | "etherfuse"
 * - GET  /v1/fiat/deposits              — lista deposits da Company
 * - GET  /v1/fiat/deposits/:id          — status atual (auto-poll se stale; router por anchorId)
 * - POST /v1/fiat/deposits/:id/refresh  — força poll on-demand
 * - POST /v1/fiat/deposits/:id/simulate — SANDBOX ONLY (Etherfuse): simula Pix/SPEI recebido
 *
 * Auth: Bearer cr_ (Agent). RBAC mais granular vem na iter 10 com NextAuth.
 */

import { FiatTransactionStatus } from '@prisma/client';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { env } from '../env.js';
import { ConflictError, NotFoundError, StellarError } from '../lib/errors.js';
import {
  initiateEtherfuseDeposit,
  pollAndSyncEtherfuseDeposit,
  simulateEtherfuseFiatReceived,
} from '../services/etherfuse-ramp.js';
import {
  initiateFiatDeposit,
  pollAndSyncDeposit,
  serializeFiatDeposit,
} from '../services/fiat-deposit.js';

/**
 * Body do POST /v1/fiat/deposits — discriminated union por `provider`.
 *
 * Nota: o discriminador precisa ser `z.literal` puro nas duas variantes
 * (sem `.optional().default()` — isso quebra a discriminação do Zod). O
 * default de `provider` é aplicado manualmente antes do parse.
 */
const InitiateDepositBody = z.discriminatedUnion('provider', [
  // SEP-24 (test-anchor SDF)
  z.object({
    provider: z.literal('sep24'),
    amountCents: z.number().int().positive(),
    asset: z
      .string()
      .min(1)
      .max(12)
      .regex(/^[A-Z0-9]+$/)
      .default('USDC'),
  }),
  // Etherfuse — LATAM anchor (Pix/SPEI)
  z.object({
    provider: z.literal('etherfuse'),
    /** Source asset que o admin paga via fiat ("BRL", "MXN", "USD"). */
    sourceAsset: z
      .string()
      .min(1)
      .max(12)
      .regex(/^[A-Z]+$/),
    /** Valor a pagar em centavos da source. */
    sourceAmountCents: z.number().int().positive(),
    /** Asset Stellar destino (USDC, TESOURO, EURC). */
    asset: z
      .string()
      .min(1)
      .max(12)
      .regex(/^[A-Z0-9]+$/),
    /** Identifier completo "CODE:ISSUER" descoberto via /ramp/assets. */
    targetAssetIdentifier: z.string().min(1),
  }),
]);

const ListQuery = z.object({
  status: z.nativeEnum(FiatTransactionStatus).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const fiatRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ----- POST /v1/fiat/deposits (seletor provider) -----
  app.post('/v1/fiat/deposits', async (request, reply) => {
    const caller = request.requireAgent();
    // Default `provider` = "sep24" aplicado antes do parse (discriminador exige literal puro)
    const rawBody = (request.body ?? {}) as Record<string, unknown>;
    const body = InitiateDepositBody.parse({
      ...rawBody,
      provider: rawBody.provider ?? 'sep24',
    });

    // No MVP, userId placeholder: primeiro OWNER da Company
    const owner = await app.prisma.user.findFirst({
      where: { companyId: caller.companyId, role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) {
      throw new ConflictError(
        `Company ${caller.companyId} has no OWNER user — required to initiate fiat deposit.`,
      );
    }

    if (body.provider === 'etherfuse') {
      if (!app.etherfuse) {
        throw new StellarError(
          'Etherfuse anchor unavailable: ETHERFUSE_API_KEY not configured on this deployment.',
        );
      }
      if (!app.etherfuseCustomerId || !app.etherfuseBankAccountId) {
        throw new ConflictError(
          'ETHERFUSE_CUSTOMER_ID / ETHERFUSE_BANK_ACCOUNT_ID not configured. ' +
            'Run `pnpm --filter @aegis/api setup:etherfuse` to register a customer programmatically.',
        );
      }

      const result = await initiateEtherfuseDeposit(app.prisma, {
        app,
        companyId: caller.companyId,
        userId: owner.id,
        targetAsset: body.asset,
        targetAssetIdentifier: body.targetAssetIdentifier,
        sourceAsset: body.sourceAsset,
        sourceAmountCents: body.sourceAmountCents,
        treasuryPublicKey: app.stellar.treasuryPublicKey,
        customerId: app.etherfuseCustomerId,
        bankAccountId: app.etherfuseBankAccountId,
        client: app.etherfuse,
      });

      reply.code(201);
      return {
        ...serializeFiatDeposit(result.deposit, { network: env.STELLAR_NETWORK }),
        provider: 'etherfuse',
        sandbox: app.etherfuse.isSandbox,
        paymentInstructions: result.paymentInstructions,
        orderId: result.orderId,
        hint: app.etherfuse.isSandbox
          ? 'Sandbox: POST /v1/fiat/deposits/:id/simulate para simular Pix/SPEI recebido sem pagar.'
          : 'Pague via Pix/SPEI usando paymentInstructions e o valor exato.',
      };
    }

    // SEP-24 fallback (default)
    const result = await initiateFiatDeposit(app.prisma, {
      app,
      companyId: caller.companyId,
      userId: owner.id,
      amountCents: body.amountCents,
      asset: body.asset,
    });

    reply.code(201);
    return {
      ...serializeFiatDeposit(result.deposit, { network: env.STELLAR_NETWORK }),
      provider: 'sep24',
      interactiveUrl: result.interactiveUrl,
      expiresAt: result.expiresAt,
    };
  });

  // ----- GET /v1/fiat/deposits -----
  app.get('/v1/fiat/deposits', async (request) => {
    const caller = request.requireAgent();
    const query = ListQuery.parse(request.query);

    const items = await app.prisma.fiatDeposit.findMany({
      where: {
        companyId: caller.companyId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });

    return {
      data: items.map((d) => serializeFiatDeposit(d, { network: env.STELLAR_NETWORK })),
    };
  });

  // ----- GET /v1/fiat/deposits/:id (router por anchorId) -----
  app.get<{ Params: { id: string } }>('/v1/fiat/deposits/:id', async (request) => {
    const caller = request.requireAgent();
    const existing = await app.prisma.fiatDeposit.findFirst({
      where: { id: request.params.id, companyId: caller.companyId },
    });
    if (!existing) throw new NotFoundError(`FiatDeposit ${request.params.id} not found`);

    const synced = await syncByAnchor(app, existing.id, existing.anchorId, false);
    return serializeFiatDeposit(synced, { network: env.STELLAR_NETWORK });
  });

  // ----- POST /v1/fiat/deposits/:id/refresh -----
  app.post<{ Params: { id: string } }>(
    '/v1/fiat/deposits/:id/refresh',
    async (request) => {
      const caller = request.requireAgent();
      const existing = await app.prisma.fiatDeposit.findFirst({
        where: { id: request.params.id, companyId: caller.companyId },
      });
      if (!existing) throw new NotFoundError(`FiatDeposit ${request.params.id} not found`);

      const synced = await syncByAnchor(app, existing.id, existing.anchorId, true);
      return serializeFiatDeposit(synced, { network: env.STELLAR_NETWORK });
    },
  );

  // ----- POST /v1/fiat/deposits/:id/simulate (sandbox-only, Etherfuse) -----
  app.post<{ Params: { id: string } }>(
    '/v1/fiat/deposits/:id/simulate',
    async (request) => {
      const caller = request.requireAgent();
      const existing = await app.prisma.fiatDeposit.findFirst({
        where: { id: request.params.id, companyId: caller.companyId },
      });
      if (!existing) throw new NotFoundError(`FiatDeposit ${request.params.id} not found`);

      if (!existing.anchorId.startsWith('etherfuse')) {
        throw new ConflictError(
          `simulate only available for Etherfuse deposits (anchorId=${existing.anchorId})`,
        );
      }
      if (!app.etherfuse) {
        throw new StellarError('Etherfuse anchor unavailable: ETHERFUSE_API_KEY not configured.');
      }

      const synced = await simulateEtherfuseFiatReceived(
        app.prisma,
        app,
        app.etherfuse,
        existing.id,
      );
      return serializeFiatDeposit(synced, { network: env.STELLAR_NETWORK });
    },
  );
};

/**
 * Roteia o poll para o orchestrator certo conforme `anchorId`.
 */
async function syncByAnchor(
  app: FastifyInstance,
  depositId: string,
  anchorId: string,
  force: boolean,
) {
  if (anchorId.startsWith('etherfuse')) {
    if (!app.etherfuse) {
      throw new StellarError(
        `FiatDeposit ${depositId} is from Etherfuse but client not configured on this deployment.`,
      );
    }
    return await pollAndSyncEtherfuseDeposit(app.prisma, app, app.etherfuse, depositId, { force });
  }
  // Default: SEP-24
  return await pollAndSyncDeposit(app.prisma, app, depositId, { force });
}

export default fiatRoute;
