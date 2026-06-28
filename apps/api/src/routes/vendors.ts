/**
 * Rotas de Vendor (CRUD básico, sem sponsoring on-chain).
 *
 * Vendor sem wallet sponsored ainda não pode receber pagamento — isso fica
 * pra iteração 5 quando integrarmos com @aegis/stellar. No MVP da iteração 4,
 * Vendor é apenas um registro lógico.
 */

import { VendorStatus, VendorWalletStatus } from '@prisma/client';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { env } from '../env.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { sponsorVendorWallet } from '../services/vendor-sponsoring.js';

const CreateVendorBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  website: z.string().max(255).optional(),
  category: z.string().max(64).optional(),
  contactEmail: z.string().email().max(255).optional(),
  preferredAsset: z.string().min(1).max(12).regex(/^[A-Z0-9]+$/).default('USDC'),
  metadata: z.record(z.unknown()).optional(),
  /**
   * Se true, executa sponsoring CAP-33 on-chain imediatamente após criar o
   * Vendor (4-op atomic tx). Default false — sponsoring pode ser disparado
   * posteriormente via POST /v1/vendors/:id/wallets/sponsor.
   */
  sponsorWallet: z.boolean().default(false),
});

const PatchVendorBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2_000).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  category: z.string().max(64).nullable().optional(),
  contactEmail: z.string().email().max(255).nullable().optional(),
  preferredAsset: z.string().min(1).max(12).regex(/^[A-Z0-9]+$/).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.nativeEnum(VendorStatus).optional(),
});

const vendorsRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ----- LIST -----
  app.get('/v1/vendors', async (request) => {
    const caller = request.requireAuth();
    const vendors = await app.prisma.vendor.findMany({
      where: { companyId: caller.companyId },
      include: { wallets: { where: { isPrimary: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { data: vendors };
  });

  // ----- GET BY ID -----
  app.get<{ Params: { id: string } }>('/v1/vendors/:id', async (request) => {
    const caller = request.requireAuth();
    const found = await app.prisma.vendor.findFirst({
      where: { id: request.params.id, companyId: caller.companyId },
      include: { wallets: true },
    });
    if (!found) throw new NotFoundError(`Vendor ${request.params.id} not found`);
    return found;
  });

  // ----- CREATE -----
  app.post('/v1/vendors', async (request, reply) => {
    const caller = request.requireAuth();
    const body = CreateVendorBody.parse(request.body);
    const created = await app.prisma.vendor.create({
      data: {
        companyId: caller.companyId,
        name: body.name,
        description: body.description,
        website: body.website,
        category: body.category,
        contactEmail: body.contactEmail,
        preferredAsset: body.preferredAsset,
        metadata: (body.metadata ?? {}) as object,
      },
    });

    let walletInfo: Record<string, unknown> | null = null;
    if (body.sponsorWallet) {
      if (!env.VENDOR_KEY_ENCRYPTION_KEY) {
        throw new ConflictError(
          'VENDOR_KEY_ENCRYPTION_KEY not configured; cannot sponsor vendor wallet.',
        );
      }
      const result = await sponsorVendorWallet(app.prisma, {
        app,
        vendor: created,
        encryptionKey: env.VENDOR_KEY_ENCRYPTION_KEY,
        network: env.STELLAR_NETWORK,
        usdcIssuer: env.USDC_ASSET_ISSUER,
      });
      walletInfo = {
        publicKey: result.vendorWallet.publicKey,
        status: result.vendorWallet.status,
        sponsorshipTxHash: result.txHash,
        xlmLocked: result.xlmLocked,
        stellarExpertUrl: `https://stellar.expert/explorer/${
          env.STELLAR_NETWORK === 'mainnet' ? 'public' : 'testnet'
        }/tx/${result.txHash}`,
      };
    }

    reply.code(201);
    return { ...created, wallet: walletInfo };
  });

  // ----- POST /v1/vendors/:id/wallets/sponsor (cria wallet sponsoreada) -----
  app.post<{ Params: { id: string } }>(
    '/v1/vendors/:id/wallets/sponsor',
    async (request, reply) => {
      const caller = request.requireAuth();
      if (!env.VENDOR_KEY_ENCRYPTION_KEY) {
        throw new ConflictError(
          'VENDOR_KEY_ENCRYPTION_KEY not configured; cannot sponsor vendor wallet.',
        );
      }
      const vendor = await app.prisma.vendor.findFirst({
        where: { id: request.params.id, companyId: caller.companyId },
      });
      if (!vendor) throw new NotFoundError(`Vendor ${request.params.id} not found`);

      const result = await sponsorVendorWallet(app.prisma, {
        app,
        vendor,
        encryptionKey: env.VENDOR_KEY_ENCRYPTION_KEY,
        network: env.STELLAR_NETWORK,
        usdcIssuer: env.USDC_ASSET_ISSUER,
      });

      reply.code(result.alreadyExisted ? 200 : 201);
      return {
        vendor: { id: vendor.id, name: vendor.name, preferredAsset: vendor.preferredAsset },
        wallet: {
          id: result.vendorWallet.id,
          publicKey: result.vendorWallet.publicKey,
          status: result.vendorWallet.status,
          sponsorshipTxHash: result.txHash,
          xlmLocked: result.xlmLocked,
          stellarExpertUrl: `https://stellar.expert/explorer/${
            env.STELLAR_NETWORK === 'mainnet' ? 'public' : 'testnet'
          }/tx/${result.txHash}`,
        },
        alreadyExisted: result.alreadyExisted,
      };
    },
  );

  // ----- PATCH -----
  app.patch<{ Params: { id: string } }>('/v1/vendors/:id', async (request) => {
    const caller = request.requireAuth();
    const body = PatchVendorBody.parse(request.body);

    const existing = await app.prisma.vendor.findFirst({
      where: { id: request.params.id, companyId: caller.companyId },
    });
    if (!existing) throw new NotFoundError(`Vendor ${request.params.id} not found`);

    const updated = await app.prisma.vendor.update({
      where: { id: request.params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.website !== undefined ? { website: body.website } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
        ...(body.preferredAsset !== undefined ? { preferredAsset: body.preferredAsset } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata as object } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
    });
    return updated;
  });

  // ----- DELETE (soft via status=SUSPENDED no MVP — sponsorship revoke vem na iter 5) -----
  app.delete<{ Params: { id: string } }>('/v1/vendors/:id', async (request, reply) => {
    const caller = request.requireAuth();
    const existing = await app.prisma.vendor.findFirst({
      where: { id: request.params.id, companyId: caller.companyId },
    });
    if (!existing) throw new NotFoundError(`Vendor ${request.params.id} not found`);

    await app.prisma.vendor.update({
      where: { id: request.params.id },
      data: { status: VendorStatus.SUSPENDED },
    });
    reply.code(204);
  });
};

export default vendorsRoute;
