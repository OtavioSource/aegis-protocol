/**
 * Demo reset — limpa todos os dados da Company "Demo Inc" para um demo do zero.
 *
 * O que apaga:
 *   - SpendRequests (cascade: Approvals + AuditEvents.spendRequestId = NULL)
 *   - AuditEvents
 *   - FiatDeposits + FiatWithdrawals
 *   - Vendors (cascade: VendorWallets)
 *   - Agents
 *   - Policies
 *
 * O que mantém:
 *   - Company "Demo Inc"
 *   - User "demo@demo.com" (login do dashboard)
 *
 * O que recria (piso técnico para o dashboard autenticar):
 *   - 1 Policy "Default Policy" (ativa)
 *   - 1 Agent "Demo Agent" (com nova API key)
 *
 * Execução:
 *   pnpm --filter @aegis/api db:reset:demo
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
    throw new Error('reset-demo.ts: refusing to run in NODE_ENV=production');
  }

  console.log('🧹 Aegis Protocol — Reset demo company\n');

  // Garante Company + User. Se não existirem, cria (idempotente com seed-demo).
  const company = await prisma.company.upsert({
    where: { slug: DEMO_COMPANY_SLUG },
    create: { name: 'Demo Inc', slug: DEMO_COMPANY_SLUG },
    update: {},
  });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
  await prisma.user.upsert({
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

  // ============ Limpeza em ordem segura ============
  // 1. Solta FK Company.defaultPolicyId pra poder deletar Policies depois
  await prisma.company.update({
    where: { id: company.id },
    data: { defaultPolicyId: null },
  });

  // 2. SpendRequests (cascade -> Approval; SetNull em AuditEvent.spendRequestId)
  const sr = await prisma.spendRequest.deleteMany({ where: { companyId: company.id } });

  // 3. AuditEvents remanescentes (os que não estavam ligados a SR)
  const ae = await prisma.auditEvent.deleteMany({ where: { companyId: company.id } });

  // 4. Fiat
  const fd = await prisma.fiatDeposit.deleteMany({ where: { companyId: company.id } });
  const fw = await prisma.fiatWithdrawal.deleteMany({ where: { companyId: company.id } });

  // 5. Vendors (cascade -> VendorWallet)
  const vd = await prisma.vendor.deleteMany({ where: { companyId: company.id } });

  // 6. Agents (já não há SpendRequests apontando)
  const ag = await prisma.agent.deleteMany({ where: { companyId: company.id } });

  // 7. Policies (já não há Agents nem SpendRequests apontando)
  const pl = await prisma.policy.deleteMany({ where: { companyId: company.id } });

  console.log('Deleted:');
  console.log(`  SpendRequests:    ${sr.count}`);
  console.log(`  AuditEvents:      ${ae.count}`);
  console.log(`  FiatDeposits:     ${fd.count}`);
  console.log(`  FiatWithdrawals:  ${fw.count}`);
  console.log(`  Vendors:          ${vd.count}`);
  console.log(`  Agents:           ${ag.count}`);
  console.log(`  Policies:         ${pl.count}\n`);

  // ============ Recria piso técnico (Policy + Agent ativos) ============
  const policy = await prisma.policy.create({
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
  });

  await prisma.company.update({
    where: { id: company.id },
    data: { defaultPolicyId: policy.id },
  });

  const { apiKey, prefix } = generateApiKey();
  const apiKeyHash = await bcrypt.hash(apiKey, BCRYPT_ROUNDS);
  const agent = await prisma.agent.create({
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

  console.log('Recreated bootstrap (technical floor for dashboard auth):');
  console.log(`  Policy:  ${policy.name} v${policy.version}`);
  console.log(`  Agent:   ${agent.name}  (${prefix}…)\n`);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  NEW API KEY (shown only once — copy now):');
  console.log(`  ${apiKey}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Next steps:');
  console.log('  1. Replace AEGIS_API_KEY in apps/web/.env.local with the key above');
  console.log("  2. Restart the web dev server (Ctrl+C and re-run 'pnpm --filter @aegis/web dev')");
  console.log(`  3. Open http://localhost:3000 and sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log('     Dashboard will show 1 policy + 1 agent (bootstrap) and zero of everything else.\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Reset failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
