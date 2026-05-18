/**
 * Aegis Protocol — Seed script (idempotente; safe pra dev/testnet).
 *
 * Cria o conjunto mínimo de dados pra desenvolvimento e demo do MVP:
 * - 1 Company  ("Aegis Demo Co")
 * - 1 User OWNER (admin@aegis-demo.com)
 * - 1 Policy default ativa
 * - 1 Agent com API key gerada (exibida UMA vez no console)
 * - 1 Vendor exemplo (sem wallet sponsored — vem na iteração 5)
 * - 1 TreasuryAccount placeholder (chave real é configurada na iteração 5)
 *
 * Comportamento:
 * - Idempotente via upsert por slug/email único. Re-rodar não duplica nem
 *   destrói dados não-seed.
 * - Agent é DELETADO antes de recriar (única forma de gerar nova API key
 *   exibível). Para regenerar API key, basta rodar o seed de novo.
 *
 * Execução:
 *   pnpm --filter @aegis/api db:seed
 *
 * Guarda contra prod:
 *   NODE_ENV=production aborta a execução.
 */

import { randomBytes } from 'node:crypto';

import {
  AgentStatus,
  Network,
  PrismaClient,
  UserRole,
  VendorStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const DEMO_PASSWORD = 'admin123';
const BCRYPT_ROUNDS = 10;
const COMPANY_SLUG = 'aegis-demo';
const ADMIN_EMAIL = 'admin@aegis-demo.com';

const prisma = new PrismaClient();

function generateApiKey(): { apiKey: string; prefix: string } {
  // 24 bytes → 32 chars base64url (URL-safe, sem padding)
  const apiKey = `cr_${randomBytes(24).toString('base64url')}`;
  const prefix = apiKey.slice(0, 11); // "cr_xxxxxxxx" (3 + 8 chars)
  return { apiKey, prefix };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed.ts: refusing to run in NODE_ENV=production');
  }

  console.log('🌱 Aegis Protocol — Seed script');
  console.log(`   DB: ${process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] ?? 'unknown'}\n`);

  // ============ Company ============
  const company = await prisma.company.upsert({
    where: { slug: COMPANY_SLUG },
    create: {
      name: 'Aegis Demo Co',
      slug: COMPANY_SLUG,
    },
    update: {},
  });
  console.log(`🏢 Company: ${company.name} (${company.id})`);

  // ============ User OWNER ============
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
  const user = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      email: ADMIN_EMAIL,
      name: 'Camila CTO',
      passwordHash,
      role: UserRole.OWNER,
      companyId: company.id,
    },
    update: {
      passwordHash, // rehash em cada seed garante senha conhecida
    },
  });
  console.log(`👤 User OWNER: ${user.email} (senha de dev: "${DEMO_PASSWORD}")`);

  // ============ Policy Default ============
  const existingPolicy = await prisma.policy.findFirst({
    where: { companyId: company.id, name: 'Default Conservative Policy', isActive: true },
  });
  const policy =
    existingPolicy ??
    (await prisma.policy.create({
      data: {
        companyId: company.id,
        name: 'Default Conservative Policy',
        version: 1,
        rules: {
          maxPerTransactionCents: 50_000, // $500
          monthlyBudgetCents: 5_000_000, // $50,000
          vendorAllowList: [],
          vendorDenyList: [],
          actionTypes: ['api-call', 'compute', 'scraping'],
          humanApprovalThresholdCents: 10_000, // $100 escala para humano
          pathPaymentSlippage: 0.01, // 1%
        },
        isActive: true,
      },
    }));
  console.log(`📋 Policy: ${policy.name} v${policy.version}`);

  // defaultPolicyId na Company (apontar para a policy ativa)
  if (company.defaultPolicyId !== policy.id) {
    await prisma.company.update({
      where: { id: company.id },
      data: { defaultPolicyId: policy.id },
    });
  }

  // ============ Agent (sempre regenera API key) ============
  await prisma.agent.deleteMany({
    where: { companyId: company.id, name: 'Customer Success Bot' },
  });

  const { apiKey, prefix } = generateApiKey();
  const apiKeyHash = await bcrypt.hash(apiKey, BCRYPT_ROUNDS);
  const agent = await prisma.agent.create({
    data: {
      companyId: company.id,
      name: 'Customer Success Bot',
      description: 'Agente Claude/GPT pra automatizar atendimento tier-1',
      apiKeyHash,
      apiKeyPrefix: prefix,
      activePolicyId: policy.id,
      status: AgentStatus.ACTIVE,
      metadata: { team: 'cs', model: 'claude-opus-4-7' },
    },
  });
  console.log(`🤖 Agent: ${agent.name} (${agent.apiKeyPrefix}…)`);
  console.log('\n   ⚠  API KEY (exibida UMA vez — salve agora se for usar):');
  console.log(`   ${apiKey}\n`);

  // ============ Vendor exemplo ============
  const existingVendor = await prisma.vendor.findFirst({
    where: { companyId: company.id, name: 'Anthropic' },
  });
  const vendor =
    existingVendor ??
    (await prisma.vendor.create({
      data: {
        companyId: company.id,
        name: 'Anthropic',
        description: 'LLM API provider (demo; sem wallet sponsored — vem na iteração 5)',
        preferredAsset: 'USDC',
        metadata: { url: 'https://anthropic.com' },
        status: VendorStatus.ACTIVE,
      },
    }));
  console.log(`🏪 Vendor: ${vendor.name} (preferredAsset: ${vendor.preferredAsset})`);

  // ============ TreasuryAccount (singleton, placeholder) ============
  const placeholderPublicKey =
    process.env.TREASURY_PUBLIC_KEY && !process.env.TREASURY_PUBLIC_KEY.startsWith('G_REPLACE')
      ? process.env.TREASURY_PUBLIC_KEY
      : 'GPLACEHOLDERREPLACEMEATITERATION5SETUPTREASURY';

  const treasury = await prisma.treasuryAccount.upsert({
    where: { publicKey: placeholderPublicKey },
    create: {
      publicKey: placeholderPublicKey,
      network: Network.TESTNET,
      secretKeyEnvVar: 'TREASURY_SECRET',
      auditContractId: null,
    },
    update: {},
  });
  console.log(`💰 Treasury: ${treasury.publicKey} (network: ${treasury.network})`);
  if (placeholderPublicKey.startsWith('GPLACEHOLDER')) {
    console.log('   ⚠  Treasury é placeholder; configure TREASURY_PUBLIC_KEY no .env.local');
    console.log('      após gerar keypair real na iteração 5 (setup-treasury script).');
  }

  console.log('\n✅ Seed completo.\n');
  console.log('Próximos passos:');
  console.log(`  1. Login no dashboard: ${user.email} / ${DEMO_PASSWORD}`);
  console.log(`  2. Use a API key acima no @aegis/sdk como Authorization: Bearer <key>`);
  console.log('  3. Re-rode o seed pra gerar nova API key se perder.');
}

main()
  .catch((e) => {
    console.error('\n❌ Seed falhou:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
