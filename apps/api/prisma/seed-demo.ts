/**
 * Demo seed — usado para gravação ao vivo / apresentação a investidor.
 *
 * Cria uma Company nova "Demo Inc" com user e Agent próprios, isolada do
 * seed default (admin@aegis-demo.com). Como o dashboard usa a AEGIS_API_KEY
 * do .env.local para falar com a API, trocar essa key pelo Agent novo faz
 * o dashboard "começar do zero" sem precisar limpar o banco.
 *
 * Execução:
 *   pnpm --filter @aegis/api db:seed:demo
 *
 * Próximos passos (impressos no console ao final):
 *   1. Substituir AEGIS_API_KEY em apps/web/.env.local
 *   2. Reiniciar o dev server da web
 *   3. Login com demo@demo.com / demo123
 */

import { randomBytes } from 'node:crypto';

import { AgentStatus, PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const DEMO_COMPANY_SLUG = 'demo-inc';
const DEMO_EMAIL = 'demo@demo.com';
const DEMO_PASSWORD = 'demo123';
const BCRYPT_ROUNDS = 10;

const prisma = new PrismaClient();

function generateApiKey(): { apiKey: string; prefix: string } {
  const apiKey = `cr_${randomBytes(24).toString('base64url')}`;
  const prefix = apiKey.slice(0, 11);
  return { apiKey, prefix };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-demo.ts: refusing to run in NODE_ENV=production');
  }

  console.log('🎬 Aegis Protocol — Demo seed (live presentation)\n');

  // ============ Company ============
  const company = await prisma.company.upsert({
    where: { slug: DEMO_COMPANY_SLUG },
    create: { name: 'Demo Inc', slug: DEMO_COMPANY_SLUG },
    update: {},
  });
  console.log(`🏢 Company: ${company.name}`);

  // ============ User OWNER ============
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: {
      email: DEMO_EMAIL,
      name: 'Demo Admin',
      passwordHash,
      role: UserRole.OWNER,
      companyId: company.id,
    },
    update: { passwordHash },
  });
  console.log(`👤 User:    ${user.email}  (password: "${DEMO_PASSWORD}")`);

  // ============ Policy Default ============
  const existingPolicy = await prisma.policy.findFirst({
    where: { companyId: company.id, name: 'Default Policy' },
  });
  const policy =
    existingPolicy ??
    (await prisma.policy.create({
      data: {
        companyId: company.id,
        name: 'Default Policy',
        version: 1,
        rules: {
          maxPerTransactionCents: 50_000,
          monthlyBudgetCents: 5_000_000,
          vendorAllowList: [],
          vendorDenyList: [],
          actionTypes: ['api-call', 'compute', 'scraping'],
          humanApprovalThresholdCents: 10_000,
          pathPaymentSlippage: 0.01,
        },
        isActive: true,
      },
    }));

  if (company.defaultPolicyId !== policy.id) {
    await prisma.company.update({
      where: { id: company.id },
      data: { defaultPolicyId: policy.id },
    });
  }
  console.log(`📋 Policy:  ${policy.name} v${policy.version}`);

  // ============ Agent (regenera API key a cada execução) ============
  const { apiKey, prefix } = generateApiKey();
  const apiKeyHash = await bcrypt.hash(apiKey, BCRYPT_ROUNDS);
  const existingAgent = await prisma.agent.findFirst({
    where: { companyId: company.id, name: 'Demo Agent' },
  });
  const agent = existingAgent
    ? await prisma.agent.update({
        where: { id: existingAgent.id },
        data: {
          apiKeyHash,
          apiKeyPrefix: prefix,
          activePolicyId: policy.id,
          status: AgentStatus.ACTIVE,
          revokedAt: null,
        },
      })
    : await prisma.agent.create({
        data: {
          companyId: company.id,
          name: 'Demo Agent',
          description: 'Live demo agent',
          apiKeyHash,
          apiKeyPrefix: prefix,
          activePolicyId: policy.id,
          status: AgentStatus.ACTIVE,
          metadata: { team: 'demo' },
        },
      });
  console.log(`🤖 Agent:   ${agent.name}  (${prefix}…)\n`);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  NEW API KEY (shown only once — copy now):');
  console.log(`  ${apiKey}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Next steps:');
  console.log('  1. Replace AEGIS_API_KEY in apps/web/.env.local with the key above');
  console.log("  2. Restart the web dev server (Ctrl+C and re-run 'pnpm --filter @aegis/web dev')");
  console.log(`  3. Open http://localhost:3000 and sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log('     Dashboard will show ZERO spend requests / vendors / agents — clean stage for demo.\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Demo seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
