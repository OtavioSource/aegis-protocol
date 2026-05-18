/**
 * Rotas de Vendor (CRUD básico, sem sponsoring on-chain).
 *
 * Vendor sem wallet sponsored ainda não pode receber pagamento — isso fica
 * pra iteração 5 quando integrarmos com @aegis/stellar. No MVP da iteração 4,
 * Vendor é apenas um registro lógico.
 */

import { VendorStatus } from '@prisma/client';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { NotFoundError } from '../lib/errors.js';

const CreateVendorBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  preferredAsset: z.string().min(1).max(12).regex(/^[A-Z0-9]+$/).default('USDC'),
  metadata: z.record(z.unknown()).optional(),
});

const PatchVendorBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2_000).nullable().optional(),
  preferredAsset: z.string().min(1).max(12).regex(/^[A-Z0-9]+$/).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.nativeEnum(VendorStatus).optional(),
});

const vendorsRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ----- LIST -----
  app.get('/v1/vendors', async (request) => {
    const caller = request.requireAgent();
    const vendors = await app.prisma.vendor.findMany({
      where: { companyId: caller.companyId },
      include: { wallets: { where: { isPrimary: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { data: vendors };
  });

  // ----- GET BY ID -----
  app.get<{ Params: { id: string } }>('/v1/vendors/:id', async (request) => {
    const caller = request.requireAgent();
    const found = await app.prisma.vendor.findFirst({
      where: { id: request.params.id, companyId: caller.companyId },
      include: { wallets: true },
    });
    if (!found) throw new NotFoundError(`Vendor ${request.params.id} not found`);
    return found;
  });

  // ----- CREATE -----
  app.post('/v1/vendors', async (request, reply) => {
    const caller = request.requireAgent();
    const body = CreateVendorBody.parse(request.body);
    const created = await app.prisma.vendor.create({
      data: {
        companyId: caller.companyId,
        name: body.name,
        description: body.description,
        preferredAsset: body.preferredAsset,
        metadata: (body.metadata ?? {}) as object,
      },
    });
    reply.code(201);
    return created;
  });

  // ----- PATCH -----
  app.patch<{ Params: { id: string } }>('/v1/vendors/:id', async (request) => {
    const caller = request.requireAgent();
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
        ...(body.preferredAsset !== undefined ? { preferredAsset: body.preferredAsset } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata as object } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
    });
    return updated;
  });

  // ----- DELETE (soft via status=SUSPENDED no MVP — sponsorship revoke vem na iter 5) -----
  app.delete<{ Params: { id: string } }>('/v1/vendors/:id', async (request, reply) => {
    const caller = request.requireAgent();
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
