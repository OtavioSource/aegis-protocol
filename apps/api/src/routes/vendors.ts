/**
 * @file vendors.ts
 * @package apps/api
 *
 * ═══════════════════════════════════════════════════════════════
 *  VENDORS — PAYMENT RECIPIENT REGISTRY
 * ═══════════════════════════════════════════════════════════════
 *
 * Vendors are the real-world entities that receive payments from AI agents.
 * Each vendor has a registered Solana wallet address — this is what makes
 * Solana transfers REAL (funds go to a different wallet, not a self-transfer).
 *
 * The vendor name in the registry must match exactly the vendor names agents
 * use in spend requests (case-insensitive match in the policy engine for
 * allow/deny lists, but exact match here for wallet lookup).
 *
 * Routes:
 *   POST /companies/:companyId/vendors        — register a vendor
 *   GET  /companies/:companyId/vendors        — list company vendors
 *   PATCH /vendors/:vendorId                  — update wallet/description/status
 *   DELETE /vendors/:vendorId                 — remove vendor
 */

import type { FastifyInstance } from 'fastify';
import { CreateVendorSchema, UpdateVendorSchema } from '@command-rail/shared';

export async function vendorsRoutes(app: FastifyInstance) {
  // ─── POST /companies/:companyId/vendors ───────────────────────────────────
  // Register a new vendor with a Solana wallet address.
  // The wallet address is used as the transfer destination when an agent's
  // spend request targeting this vendor is executed on-chain.
  app.post<{ Params: { companyId: string } }>(
    '/companies/:companyId/vendors',
    async (request, reply) => {
      const { companyId } = request.params;
      const body = CreateVendorSchema.parse(request.body);

      const company = await app.prisma.company.findUnique({ where: { id: companyId } });
      if (!company) return reply.notFound('Company not found');

      // Check for duplicate vendor name in this company
      const existing = await app.prisma.vendor.findUnique({
        where: { companyId_name: { companyId, name: body.name } },
      });
      if (existing) return reply.conflict(`Vendor '${body.name}' already registered`);

      const vendor = await app.prisma.vendor.create({
        data: {
          companyId,
          name: body.name,
          walletAddress: body.walletAddress,
          description: body.description ?? null,
          status: 'ACTIVE',
        },
      });

      return reply.status(201).send(vendor);
    },
  );

  // ─── GET /companies/:companyId/vendors ────────────────────────────────────
  // List all vendors for a company, ordered by name.
  app.get<{ Params: { companyId: string } }>(
    '/companies/:companyId/vendors',
    async (request, reply) => {
      const { companyId } = request.params;

      const company = await app.prisma.company.findUnique({ where: { id: companyId } });
      if (!company) return reply.notFound('Company not found');

      const vendors = await app.prisma.vendor.findMany({
        where: { companyId },
        orderBy: { name: 'asc' },
      });
      return vendors;
    },
  );

  // ─── PATCH /vendors/:vendorId ─────────────────────────────────────────────
  // Update a vendor's wallet address, description, or status.
  // Use status: 'BLOCKED' to hard-block a vendor (belt-and-suspenders with deny list).
  app.patch<{ Params: { vendorId: string } }>(
    '/vendors/:vendorId',
    async (request, reply) => {
      const { vendorId } = request.params;
      const body = UpdateVendorSchema.parse(request.body);

      const vendor = await app.prisma.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) return reply.notFound('Vendor not found');

      const updated = await app.prisma.vendor.update({
        where: { id: vendorId },
        data: {
          ...(body.walletAddress !== undefined ? { walletAddress: body.walletAddress } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        },
      });
      return updated;
    },
  );

  // ─── DELETE /vendors/:vendorId ────────────────────────────────────────────
  // Remove a vendor from the registry.
  // Historical spend requests referencing this vendor are preserved in the DB.
  app.delete<{ Params: { vendorId: string } }>(
    '/vendors/:vendorId',
    async (request, reply) => {
      const { vendorId } = request.params;

      const vendor = await app.prisma.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) return reply.notFound('Vendor not found');

      await app.prisma.vendor.delete({ where: { id: vendorId } });
      return reply.status(204).send();
    },
  );
}
