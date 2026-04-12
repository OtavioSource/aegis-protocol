/**
 * @file seed.ts
 * @package apps/api
 *
 * Demo seed script. Creates:
 *   - 1 company (Acme Corp)
 *   - 1 treasury (Solana devnet wallet)
 *   - 3 vendors with REAL Solana keypairs (funds will go to different wallets)
 *   - 2 agents (Marketing Bot, DevOps Agent) with policies and budgets
 *   - 1 admin user (admin@acme.com / commandrail)
 *
 * Run: pnpm --filter api db:seed
 *
 * After running, set in .env:
 *   DEMO_API_KEY=<marketing bot key>
 *   DEMO_COMPANY_ID=<company id>
 *
 * Then fund the treasury:
 *   POST /companies/:id/treasuries/:id/fund-demo
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { TreasuryService } from '@aegis/solana';

const prisma = new PrismaClient();

function hashApiKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

async function main() {
  console.log('🌱 Seeding Aegis Protocol demo data...\n');

  // ─── Company ────────────────────────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: { name: 'Acme Corp', slug: 'acme-corp' },
  });
  console.log('✅ Company:', company.name, `(${company.id})`);

  // ─── Treasury ───────────────────────────────────────────────────────────
  // Check first — avoids creating a new random wallet on every seed run.
  // Using findFirst by companyId+name so repeated seeds are truly idempotent.
  const treasuryService = new TreasuryService('devnet');

  let treasury = await prisma.treasury.findFirst({
    where: { companyId: company.id, name: 'Main Treasury' },
  });

  if (!treasury) {
    const wallet = treasuryService.createWallet();
    treasury = await prisma.treasury.create({
      data: {
        companyId: company.id,
        name: 'Main Treasury',
        network: 'devnet',
        baseCurrency: 'USDC',
        walletAddress: wallet.publicKey,
        encryptedSecret: wallet.encryptedSecret,
        status: 'ACTIVE',
      },
    });
  }
  console.log('✅ Treasury:', treasury.walletAddress);

  // ─── Vendors with real Solana wallets ────────────────────────────────────
  // Each vendor gets a fresh Solana keypair so funds go to DIFFERENT wallets.
  // This makes the on-chain transfers verifiably multi-wallet on Solana Explorer.
  const vendorDefinitions = [
    { name: 'DataVendorX', description: 'Lead data enrichment API' },
    { name: 'LeadEnricher', description: 'B2B lead intelligence platform' },
    { name: 'EmailAPI', description: 'Transactional email delivery service' },
    { name: 'OpenAI', description: 'AI inference (GPT-4, embeddings)' },
    { name: 'Anthropic', description: 'AI inference (Claude models)' },
    { name: 'AWS', description: 'Cloud compute and storage' },
    { name: 'Datadog', description: 'Infrastructure observability' },
  ];

  console.log('\n📦 Creating vendors with real Solana wallets...');
  const vendorWallets: Record<string, string> = {};

  for (const def of vendorDefinitions) {
    const vendorWallet = treasuryService.createWallet();
    vendorWallets[def.name] = vendorWallet.publicKey;

    await prisma.vendor.upsert({
      where: { companyId_name: { companyId: company.id, name: def.name } },
      update: { walletAddress: vendorWallet.publicKey },
      create: {
        companyId: company.id,
        name: def.name,
        walletAddress: vendorWallet.publicKey,
        description: def.description,
        status: 'ACTIVE',
      },
    });
    console.log(`  ✅ ${def.name}: ${vendorWallet.publicKey}`);
  }

  // ─── Marketing Bot ───────────────────────────────────────────────────────
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

  // ─── DevOps Agent ────────────────────────────────────────────────────────
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
    update: { dailyLimit: 500, monthlyLimit: 5000, perTransactionLimit: 200 },
    create: {
      companyId: company.id,
      agentId: devopsAgent.id,
      dailyLimit: 500,
      monthlyLimit: 5000,
      perTransactionLimit: 200,
      currency: 'USDC',
    },
  });

  // ─── Admin User ──────────────────────────────────────────────────────────
  const defaultPassword = 'aegis';
  const passwordHash = await bcrypt.hash(defaultPassword, 12);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@acme.com' },
    update: { passwordHash },
    create: {
      companyId: company.id,
      email: 'admin@acme.com',
      name: 'Admin',
      passwordHash,
      role: 'OWNER',
      notifyEmail: true,
      notifySms: false,
    },
  });
  console.log('\n✅ Admin user:', adminUser.email, `(role: ${adminUser.role})`);

  // ─── Output ──────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('🎉 Seed complete!');
  console.log('═'.repeat(60));
  console.log('\nAdd to apps/api/.env:');
  console.log(`DEMO_API_KEY=${marketingKey}`);
  console.log(`DEMO_COMPANY_ID=${company.id}`);
  console.log('\nDashboard login:');
  console.log('  Email:    admin@acme.com');
  console.log('  Password: aegis');
  console.log('\nTreasury wallet:', treasury.walletAddress);
  console.log('(Run POST /companies/' + company.id + '/treasuries/' + treasury.id + '/fund-demo to fund it)');
  console.log('\n📌 Marketing Bot API Key:', marketingKey);
  console.log('   Agent ID:', marketingAgent.id);
  console.log('\n📌 DevOps Agent API Key:', devopsKey);
  console.log('   Agent ID:', devopsAgent.id);
  console.log('\nVendor wallets (REAL Solana addresses — transfers go here):');
  for (const [name, addr] of Object.entries(vendorWallets)) {
    console.log(`  ${name}: ${addr}`);
  }
  console.log('═'.repeat(60) + '\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
