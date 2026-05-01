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
import { CreateVendorSchema, UpdateVendorSchema } from '@aegis/shared';
import { generateSolanaPayUri } from '@aegis/solana';

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

      // Resolve wallet address from either initialWallet (preferred, multi-chain)
      // or top-level walletAddress (legacy Solana-only flow). Schema guarantees
      // at least one is provided in practice — but we double-check defensively
      // because both are technically optional in the Zod schema.
      const walletAddress = body.initialWallet?.walletAddress ?? body.walletAddress;
      if (!walletAddress) {
        return reply.badRequest(
          'Vendor must include either `initialWallet.walletAddress` or `walletAddress`',
        );
      }

      const vendor = await app.prisma.vendor.create({
        data: {
          companyId,
          name: body.name,
          walletAddress,                                   // Vendor.walletAddress kept for back-compat
          description: body.description ?? null,
          status: 'ACTIVE',
          // VendorWallet record creation lives in Phase 5 (proper CRUD).
          // For now Vendor.walletAddress is the source of truth for both
          // Solana and Stellar flows.
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

  // ─── GET /vendors/:vendorId/solana-pay-uri ────────────────────────────────
  // Generate a Solana Pay URI for a vendor invoice.
  //
  // The vendor's wallet address is used as the payment recipient.
  // A fresh reference keypair is generated per request for on-chain tracking.
  // The returned URI can be rendered as a QR code for agents to scan, or
  // passed directly to aegis.pay(uri) in the Aegis SDK.
  //
  // Query params:
  //   amount  — required, token amount (e.g. 25.00 for 25 USDC)
  //   message — optional, invoice description
  //
  // The SPL token mint is read from DEVNET_DEMO_MINT_ADDRESS env (demo mint)
  // or falls back to the Circle devnet USDC mint.
  app.get<{ Params: { vendorId: string }; Querystring: { amount?: string; message?: string } }>(
    '/vendors/:vendorId/solana-pay-uri',
    async (request, reply) => {
      const { vendorId } = request.params;
      const { amount: amountStr, message } = request.query;

      const vendor = await app.prisma.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) return reply.notFound('Vendor not found');
      if (vendor.status === 'BLOCKED') return reply.forbidden('Vendor is blocked');

      const amount = amountStr ? parseFloat(amountStr) : undefined;
      if (!amount || isNaN(amount) || amount <= 0) {
        return reply.badRequest('Query param `amount` is required and must be a positive number');
      }

      // Use demo mint if configured, otherwise fall back to Circle devnet USDC
      const splTokenMint =
        process.env['DEVNET_DEMO_MINT_ADDRESS'] ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

      const result = generateSolanaPayUri({
        recipient: vendor.walletAddress,
        amount,
        splTokenMint,
        label: vendor.name,
        ...(message ? { message } : {}),
      });

      return {
        vendorId: vendor.id,
        vendorName: vendor.name,
        walletAddress: vendor.walletAddress,
        amount,
        currency: 'USDC',
        splTokenMint,
        uri: result.uri,
        reference: result.reference,
        explorerUrl: result.explorerUrl,
        // Hint: render result.uri as a QR code in the dashboard
        // or pass to aegis.pay(result.uri) in the Aegis SDK
      };
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
