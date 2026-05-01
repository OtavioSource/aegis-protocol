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
import { CreateVendorSchema, UpdateVendorSchema, AddVendorWalletSchema } from '@aegis/shared';
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

      // Determine the chain network for the initial wallet.
      // initialWallet wins if provided (multi-chain explicit); otherwise default
      // to 'devnet' for back-compat (legacy callers that only knew Solana).
      const initialNetwork = body.initialWallet?.network ?? 'devnet';

      // Create vendor + initial VendorWallet in a single transaction so a
      // partial failure leaves no orphan records.
      const vendor = await app.prisma.$transaction(async (tx) => {
        const created = await tx.vendor.create({
          data: {
            companyId,
            name: body.name,
            walletAddress, // Kept for back-compat — populated even when initialWallet is provided
            description: body.description ?? null,
            status: 'ACTIVE',
          },
        });

        await tx.vendorWallet.create({
          data: {
            vendorId: created.id,
            network: initialNetwork,
            walletAddress,
            trustedAssets: (body.initialWallet?.trustedAssets ?? []) as object,
          },
        });

        return created;
      });

      return reply.status(201).send(vendor);
    },
  );

  // ─── GET /vendors/:vendorId/wallets ───────────────────────────────────────
  // List all wallets registered for a vendor (one per chain).
  app.get<{ Params: { vendorId: string } }>(
    '/vendors/:vendorId/wallets',
    async (request, reply) => {
      const { vendorId } = request.params;

      const vendor = await app.prisma.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) return reply.notFound('Vendor not found');

      const wallets = await app.prisma.vendorWallet.findMany({
        where: { vendorId },
        orderBy: { network: 'asc' },
      });
      return wallets;
    },
  );

  // ─── POST /vendors/:vendorId/wallets ──────────────────────────────────────
  // Add a new wallet to an existing vendor (e.g. registering a Stellar wallet
  // for a vendor who already has a Solana wallet).
  //
  // Returns 409 if the vendor already has a wallet on the given network —
  // the @@unique([vendorId, network]) constraint enforces one wallet per chain.
  app.post<{ Params: { vendorId: string } }>(
    '/vendors/:vendorId/wallets',
    async (request, reply) => {
      const { vendorId } = request.params;
      const body = AddVendorWalletSchema.parse(request.body);

      const vendor = await app.prisma.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) return reply.notFound('Vendor not found');

      const existing = await app.prisma.vendorWallet.findUnique({
        where: { vendorId_network: { vendorId, network: body.network } },
      });
      if (existing) {
        return reply.conflict(
          `Vendor already has a wallet on '${body.network}'. ` +
            `Use PATCH on the wallet (not yet implemented) or delete it first.`,
        );
      }

      const wallet = await app.prisma.vendorWallet.create({
        data: {
          vendorId,
          network: body.network,
          walletAddress: body.walletAddress,
          trustedAssets: (body.trustedAssets ?? []) as object,
        },
      });

      return reply.status(201).send(wallet);
    },
  );

  // ─── DELETE /vendors/:vendorId/wallets/:walletId ──────────────────────────
  // Remove a specific wallet from a vendor. The vendor record itself is preserved.
  app.delete<{ Params: { vendorId: string; walletId: string } }>(
    '/vendors/:vendorId/wallets/:walletId',
    async (request, reply) => {
      const { vendorId, walletId } = request.params;

      const wallet = await app.prisma.vendorWallet.findUnique({
        where: { id: walletId },
      });
      if (!wallet || wallet.vendorId !== vendorId) {
        return reply.notFound('Wallet not found for this vendor');
      }

      await app.prisma.vendorWallet.delete({ where: { id: walletId } });
      return reply.status(204).send();
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
