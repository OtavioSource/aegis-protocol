/**
 * @file companies.ts
 * @package apps/api
 *
 * ═══════════════════════════════════════════════════════════════
 *  COMPANIES & TREASURIES — TENANT SETUP ROUTES
 * ═══════════════════════════════════════════════════════════════
 *
 * Aegis Protocol is multi-tenant. A Company is the top-level organizational
 * unit — everything (agents, treasuries, spend requests, audit logs) belongs
 * to a company.
 *
 * A Treasury represents a Solana wallet that holds funds for payment execution.
 * Companies can have multiple treasuries (e.g., one for marketing agents,
 * one for infrastructure agents), each with its own wallet keypair.
 *
 * Key design decisions:
 *
 *   1. TREASURY KEYPAIRS are generated server-side using @solana/web3.js.
 *      The secret key is base64-encoded and stored in `encryptedSecret`.
 *      In production, this should be encrypted with AES-256 before storage.
 *      For the MVP, base64 encoding is used (the threat model is demo/devnet).
 *
 *   2. `encryptedSecret` is NEVER returned in API responses.
 *      It's stripped via destructuring before any response is sent.
 *      The wallet public address (walletAddress) IS returned and public.
 *
 *   3. The `fund-demo` endpoint is a devnet-only utility. It:
 *      - Airdrops SOL to the treasury wallet (for transaction fees)
 *      - Creates or reuses an SPL token mint (demo USDC substitute)
 *      - Mints tokens to the treasury wallet
 *      This simulates receiving funds without needing a real faucet.
 *      In production, treasuries are funded via real USDC transfers.
 *
 *   4. DEMO MINT PERSISTENCE: after calling fund-demo, the response includes
 *      the mint address. This should be saved as DEVNET_DEMO_MINT_ADDRESS
 *      in .env so subsequent fund-demo and transfer calls use the same mint.
 *      Without this, each fund-demo creates a new mint incompatible with
 *      previous token accounts.
 *
 * Routes exposed:
 *   POST /companies                                    — create company/tenant
 *   GET  /companies/:companyId                         — get company + treasuries
 *   POST /companies/:companyId/treasuries              — create treasury + Solana wallet
 *   GET  /companies/:companyId/treasuries              — list treasuries (no secrets)
 *   POST /companies/:companyId/treasuries/:id/fund-demo — devnet funding utility
 */

import type { FastifyInstance } from 'fastify';
import { CreateCompanySchema, CreateTreasurySchema } from '@aegis/shared';
import { TreasuryService, fundTreasuryForDemo } from '@aegis/solana';
import { AuditEventType, ActorType } from '@aegis/shared';
import { createAuditLog } from '../services/audit.js';

export async function companiesRoutes(app: FastifyInstance) {
  // ─── POST /companies ──────────────────────────────────────────────────────
  // Create a new company/tenant. The slug must be globally unique —
  // it's used as a human-readable identifier in URLs and logs.
  app.post('/', async (request, reply) => {
    const body = CreateCompanySchema.parse(request.body);

    const existing = await app.prisma.company.findUnique({ where: { slug: body.slug } });
    if (existing) return reply.conflict(`Slug '${body.slug}' already in use`);

    const company = await app.prisma.company.create({ data: body });
    return reply.status(201).send(company);
  });

  // ─── GET /companies/:companyId ────────────────────────────────────────────
  // Get company details including its treasuries and agent count.
  // Used by the dashboard overview and setup flows.
  app.get<{ Params: { companyId: string } }>('/:companyId', async (request, reply) => {
    const company = await app.prisma.company.findUnique({
      where: { id: request.params.companyId },
      include: { treasuries: true, _count: { select: { agents: true } } },
    });
    if (!company) return reply.notFound('Company not found');
    return company;
  });

  // ─── POST /companies/:companyId/treasuries ────────────────────────────────
  // Create a treasury: generates a new Solana keypair and persists the
  // wallet address (public) and encoded secret (server-side only).
  //
  // The wallet starts with 0 SOL and 0 tokens. Use /fund-demo on devnet
  // or deposit real USDC on mainnet before agents can spend.
  app.post<{ Params: { companyId: string } }>('/:companyId/treasuries', async (request, reply) => {
    const { companyId } = request.params;
    const body = CreateTreasurySchema.parse(request.body);

    const company = await app.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return reply.notFound('Company not found');

    // Generate a fresh Solana keypair for this treasury
    const treasuryService = new TreasuryService(body.network);
    const wallet = treasuryService.createWallet();

    const treasury = await app.prisma.treasury.create({
      data: {
        companyId,
        name: body.name,
        network: body.network,
        baseCurrency: body.baseCurrency,
        walletAddress: wallet.publicKey,     // Public — visible to anyone
        encryptedSecret: wallet.encryptedSecret, // Private — server-side only
        status: 'ACTIVE',
      },
    });

    await createAuditLog({
      prisma: app.prisma,
      companyId,
      eventType: AuditEventType.TREASURY_CREATED,
      actorType: ActorType.ADMIN,
      actorId: 'admin',
      payload: { treasuryId: treasury.id, walletAddress: wallet.publicKey, network: body.network },
    });

    // Strip the secret before returning — never expose it in responses
    const { encryptedSecret: _, ...safeRecord } = treasury;
    return reply.status(201).send(safeRecord);
  });

  // ─── POST /companies/:companyId/treasuries/:treasuryId/fund-demo ──────────
  // DEVNET ONLY: Fund a treasury wallet with test tokens for demo purposes.
  //
  // This endpoint:
  //   1. Airdrops SOL to the treasury (needed for tx fees)
  //   2. Creates a custom SPL token mint (6 decimals, like USDC)
  //      OR reuses DEVNET_DEMO_MINT_ADDRESS from env if set
  //   3. Mints `amount` tokens to the treasury's token account
  //
  // After calling this endpoint, save the returned `mintAddress` as
  // DEVNET_DEMO_MINT_ADDRESS in .env. This ensures all future transfers
  // use the same mint that the treasury holds tokens for.
  //
  // Returns Solana Explorer links so you can verify the funding on-chain.
  app.post<{ Params: { companyId: string; treasuryId: string }; Body: { amount?: number } }>(
    '/:companyId/treasuries/:treasuryId/fund-demo',
    async (request, reply) => {
      const { companyId, treasuryId } = request.params;
      const amount = (request.body as { amount?: number })?.amount ?? 500;

      const treasury = await app.prisma.treasury.findFirst({
        where: { id: treasuryId, companyId },
      });
      if (!treasury) return reply.notFound('Treasury not found');

      // Safety guard: refuse to run against mainnet accidentally
      if (treasury.network !== 'devnet') return reply.badRequest('fund-demo only works on devnet');

      // Call the devnet funding utility from @aegis/solana
      // If DEVNET_DEMO_MINT_ADDRESS is set in env, reuses that mint.
      // Otherwise creates a fresh mint (and logs the address to add to .env).
      const fundArgs: Parameters<typeof fundTreasuryForDemo>[0] = {
        treasuryWalletAddress: treasury.walletAddress,
        treasuryEncryptedSecret: treasury.encryptedSecret,
        amount,
      };
      if (process.env['DEVNET_DEMO_MINT_AUTHORITY_SECRET']) {
        fundArgs.mintAuthoritySecret = process.env['DEVNET_DEMO_MINT_AUTHORITY_SECRET'];
      }
      if (process.env['DEVNET_DEMO_MINT_ADDRESS']) {
        fundArgs.existingMintAddress = process.env['DEVNET_DEMO_MINT_ADDRESS'];
      }
      const result = await fundTreasuryForDemo(fundArgs);

      // Hint to operators: if no persistent mint was configured, they should
      // save this new mint address to avoid creating a new mint every time.
      if (!process.env['DEVNET_DEMO_MINT_ADDRESS'] && result.mintAddress) {
        console.log(`ℹ️  New demo mint created: ${result.mintAddress}`);
        console.log(`   Add DEVNET_DEMO_MINT_ADDRESS=${result.mintAddress} to .env`);
      }

      await createAuditLog({
        prisma: app.prisma,
        companyId,
        eventType: AuditEventType.TREASURY_FUNDED,
        actorType: ActorType.ADMIN,
        actorId: 'admin',
        payload: {
          treasuryId,
          amount,
          mintAddress: result.mintAddress,
          txSignature: result.mintSignature,
          explorerUrl: result.explorerUrl,
        },
      });

      return {
        treasuryId,
        walletAddress: treasury.walletAddress,
        mintAddress: result.mintAddress,
        amount,
        solSignature: result.solSignature,
        mintSignature: result.mintSignature,
        explorerUrl: result.explorerUrl,  // Verify on Solana Explorer
      };
    },
  );

  // ─── GET /companies/:companyId/treasuries ─────────────────────────────────
  // List all treasuries for a company. Uses an explicit `select` to ensure
  // encryptedSecret is NEVER included in the response, even if Prisma schema
  // changes add new fields. Defense-in-depth against accidental key exposure.
  app.get<{ Params: { companyId: string } }>('/:companyId/treasuries', async (request, reply) => {
    const company = await app.prisma.company.findUnique({
      where: { id: request.params.companyId },
    });
    if (!company) return reply.notFound('Company not found');

    const treasuries = await app.prisma.treasury.findMany({
      where: { companyId: request.params.companyId },
      select: {
        id: true,
        companyId: true,
        name: true,
        network: true,
        baseCurrency: true,
        walletAddress: true, // Public address — safe to expose
        status: true,
        createdAt: true,
        updatedAt: true,
        // encryptedSecret is deliberately EXCLUDED
      },
    });
    return treasuries;
  });
}
