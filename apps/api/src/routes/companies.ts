import type { FastifyInstance } from 'fastify';
import { CreateCompanySchema, CreateTreasurySchema } from '@command-rail/shared';
import { TreasuryService, fundTreasuryForDemo } from '@command-rail/solana';
import { AuditEventType, ActorType } from '@command-rail/shared';
import { createAuditLog } from '../services/audit.js';

export async function companiesRoutes(app: FastifyInstance) {
  // POST /companies
  app.post('/', async (request, reply) => {
    const body = CreateCompanySchema.parse(request.body);

    const existing = await app.prisma.company.findUnique({ where: { slug: body.slug } });
    if (existing) return reply.conflict(`Slug '${body.slug}' already in use`);

    const company = await app.prisma.company.create({ data: body });
    return reply.status(201).send(company);
  });

  // GET /companies/:companyId
  app.get<{ Params: { companyId: string } }>('/:companyId', async (request, reply) => {
    const company = await app.prisma.company.findUnique({
      where: { id: request.params.companyId },
      include: { treasuries: true, _count: { select: { agents: true } } },
    });
    if (!company) return reply.notFound('Company not found');
    return company;
  });

  // POST /companies/:companyId/treasuries
  app.post<{ Params: { companyId: string } }>('/:companyId/treasuries', async (request, reply) => {
    const { companyId } = request.params;
    const body = CreateTreasurySchema.parse(request.body);

    const company = await app.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return reply.notFound('Company not found');

    const treasuryService = new TreasuryService(body.network);
    const wallet = treasuryService.createWallet();

    const treasury = await app.prisma.treasury.create({
      data: {
        companyId,
        name: body.name,
        network: body.network,
        baseCurrency: body.baseCurrency,
        walletAddress: wallet.publicKey,
        encryptedSecret: wallet.encryptedSecret,
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

    // Don't expose encryptedSecret in response
    const { encryptedSecret: _, ...safeRecord } = treasury;
    return reply.status(201).send(safeRecord);
  });

  // POST /companies/:companyId/treasuries/:treasuryId/fund-demo — devnet only
  app.post<{ Params: { companyId: string; treasuryId: string }; Body: { amount?: number } }>(
    '/:companyId/treasuries/:treasuryId/fund-demo',
    async (request, reply) => {
      const { companyId, treasuryId } = request.params;
      const amount = (request.body as { amount?: number })?.amount ?? 500;

      const treasury = await app.prisma.treasury.findFirst({
        where: { id: treasuryId, companyId },
      });
      if (!treasury) return reply.notFound('Treasury not found');
      if (treasury.network !== 'devnet') return reply.badRequest('fund-demo only works on devnet');

      const result = await fundTreasuryForDemo({
        treasuryWalletAddress: treasury.walletAddress,
        treasuryEncryptedSecret: treasury.encryptedSecret,
        amount,
        mintAuthoritySecret: process.env['DEVNET_DEMO_MINT_AUTHORITY_SECRET'],
        existingMintAddress: process.env['DEVNET_DEMO_MINT_ADDRESS'],
      });

      // If a custom demo mint was used, store it for future transfers
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
        explorerUrl: result.explorerUrl,
      };
    },
  );

  // GET /companies/:companyId/treasuries
  app.get<{ Params: { companyId: string } }>('/:companyId/treasuries', async (request, reply) => {
    const company = await app.prisma.company.findUnique({
      where: { id: request.params.companyId },
    });
    if (!company) return reply.notFound('Company not found');

    const treasuries = await app.prisma.treasury.findMany({
      where: { companyId: request.params.companyId },
      select: { id: true, companyId: true, name: true, network: true, baseCurrency: true, walletAddress: true, status: true, createdAt: true, updatedAt: true },
    });
    return treasuries;
  });
}
