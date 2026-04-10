/**
 * Seed script for demo data.
 * Run: pnpm --filter api db:seed
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { TreasuryService } from '@command-rail/solana';

const prisma = new PrismaClient();

function hashApiKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

async function main() {
  console.log('🌱 Seeding CommandRail demo data...');

  // Company
  const company = await prisma.company.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: { name: 'Acme Corp', slug: 'acme-corp' },
  });
  console.log('✅ Company:', company.name);

  // Treasury
  const treasuryService = new TreasuryService('devnet');
  const wallet = treasuryService.createWallet();

  const treasury = await prisma.treasury.upsert({
    where: { walletAddress: wallet.publicKey },
    update: {},
    create: {
      companyId: company.id,
      name: 'Main Treasury',
      network: 'devnet',
      baseCurrency: 'USDC',
      walletAddress: wallet.publicKey,
      encryptedSecret: wallet.encryptedSecret,
      status: 'ACTIVE',
    },
  });
  console.log('✅ Treasury:', treasury.walletAddress);

  // Marketing Agent
  const marketingKey = `cr_${nanoid(40)}`;
  const marketingAgent = await prisma.agent.upsert({
    where: { apiKeyHash: hashApiKey(marketingKey) },
    update: {},
    create: {
      companyId: company.id,
      treasuryId: treasury.id,
      name: 'Marketing Bot',
      type: 'marketing',
      ownerName: 'Growth Team',
      ownerEmail: 'growth@acme.com',
      status: 'ACTIVE',
      killSwitchActive: false,
      apiKeyHash: hashApiKey(marketingKey),
    },
  });

  await prisma.policy.upsert({
    where: { id: marketingAgent.id },
    update: {},
    create: {
      id: marketingAgent.id,
      agentId: marketingAgent.id,
      name: 'Marketing Standard Policy',
      rules: {
        requireApprovalAbove: 10,
        maxTransactionAmount: 50,
        vendorAllowList: ['DataVendorX', 'LeadEnricher', 'EmailAPI'],
        allowedActionTypes: ['purchase_api_access', 'purchase_dataset', 'enrich_leads'],
      },
      active: true,
    },
  });

  await prisma.budget.upsert({
    where: { agentId: marketingAgent.id },
    update: { dailyLimit: 10000, monthlyLimit: 50000, perTransactionLimit: 200 },
    create: {
      companyId: company.id,
      agentId: marketingAgent.id,
      dailyLimit: 10000,
      monthlyLimit: 50000,
      perTransactionLimit: 200,
      currency: 'USDC',
    },
  });

  // DevOps Agent
  const devopsKey = `cr_${nanoid(40)}`;
  const devopsAgent = await prisma.agent.upsert({
    where: { apiKeyHash: hashApiKey(devopsKey) },
    update: {},
    create: {
      companyId: company.id,
      treasuryId: treasury.id,
      name: 'DevOps Agent',
      type: 'devops',
      ownerName: 'Platform Team',
      ownerEmail: 'platform@acme.com',
      status: 'ACTIVE',
      killSwitchActive: false,
      apiKeyHash: hashApiKey(devopsKey),
    },
  });

  await prisma.policy.upsert({
    where: { id: devopsAgent.id },
    update: {},
    create: {
      id: devopsAgent.id,
      agentId: devopsAgent.id,
      name: 'DevOps Standard Policy',
      rules: {
        requireApprovalAbove: 25,
        maxTransactionAmount: 200,
        vendorAllowList: ['AWS', 'Datadog', 'OpenAI', 'Anthropic'],
        allowedActionTypes: ['purchase_compute', 'purchase_observability', 'purchase_inference'],
      },
      active: true,
    },
  });

  await prisma.budget.upsert({
    where: { agentId: devopsAgent.id },
    update: {},
    create: {
      companyId: company.id,
      agentId: devopsAgent.id,
      dailyLimit: 500,
      monthlyLimit: 5000,
      perTransactionLimit: 200,
      currency: 'USDC',
    },
  });

  console.log('');
  console.log('🎉 Seed complete!');
  console.log('');
  console.log('Company ID:', company.id);
  console.log('Treasury Wallet:', treasury.walletAddress);
  console.log('');
  console.log('📌 Marketing Bot API Key:', marketingKey);
  console.log('   Agent ID:', marketingAgent.id);
  console.log('');
  console.log('📌 DevOps Agent API Key:', devopsKey);
  console.log('   Agent ID:', devopsAgent.id);
  console.log('');
  console.log('Save these API keys — they cannot be recovered!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
