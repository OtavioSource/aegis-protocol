/**
 * @file seed-stellar.ts
 * @package apps/api
 *
 * ═══════════════════════════════════════════════════════════════
 *  STELLAR DEMO SEED — END-TO-END DB PROVISIONING
 * ═══════════════════════════════════════════════════════════════
 *
 * Reads packages/stellar/.demo-state.json (produced by `pnpm --filter
 * @aegis/stellar setup-demo`) and provisions a working Aegis demo:
 *
 *   - 1 Company ("Acme Stellar")
 *   - 1 Treasury imported from setup-demo's pre-funded USDC account
 *   - 1 Vendor ("OpenAI EU") with a Stellar VendorWallet (EURC trustline ready)
 *   - 1 Agent ("BR Marketing Bot") with policy + budget
 *
 * Idempotent — safe to re-run after every setup-demo refresh.
 *
 * After this completes, the user has everything they need to submit
 * a cross-currency SpendRequest:
 *
 *   curl -X POST http://localhost:3001/spend-requests \
 *     -H "Authorization: Bearer <printed API key>" \
 *     -H "Content-Type: application/json" \
 *     -d '{
 *       "actionType": "purchase_api_access",
 *       "vendor": "OpenAI EU",
 *       "amount": 25,
 *       "currency": "USDC",
 *       "receiveAsset": "EURC",
 *       "reason": "GPT-4 credits para campanha BR"
 *     }'
 *
 * Run: pnpm --filter @aegis/api db:seed-stellar
 *
 * Dependency on setup-demo: this script REFUSES to run without
 * .demo-state.json — that file holds the testnet account secrets and
 * issuer addresses needed for the demo to work end-to-end.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function hashApiKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

function generateApiKey(): string {
  // Match the format used by the agents.ts route (cr_ prefix + 40 chars).
  return `cr_${randomBytes(30).toString('base64url').slice(0, 40)}`;
}

type DemoState = {
  network: string;
  createdAt: string;
  usdcIssuer: { publicKey: string; secret: string };
  eurcIssuer: { publicKey: string; secret: string };
  marketMaker: { publicKey: string; secret: string };
  treasury: { publicKey: string; secret: string };
  vendor: { publicKey: string; secret: string };
};

function loadDemoState(): DemoState {
  const candidates = [
    resolve(process.cwd(), '../../packages/stellar/.demo-state.json'),
    resolve(process.cwd(), 'packages/stellar/.demo-state.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const content = readFileSync(candidate, 'utf8');
      return JSON.parse(content) as DemoState;
    }
  }
  throw new Error(
    'Could not find packages/stellar/.demo-state.json. ' +
      'Run `pnpm --filter @aegis/stellar setup-demo` first.',
  );
}

async function main() {
  console.log('🌱 Seeding Aegis Stellar demo from setup-demo state...\n');

  const state = loadDemoState();
  console.log(`📂 Loaded demo state from ${state.createdAt} (network: ${state.network})`);

  // Guard: the API needs the issuer pubkeys at runtime to resolve assets.
  // Warn (not throw) so the user can still seed and add env vars after.
  const missingEnv: string[] = [];
  if (!process.env['STELLAR_DEMO_USDC_ISSUER']) missingEnv.push('STELLAR_DEMO_USDC_ISSUER');
  if (!process.env['STELLAR_DEMO_EURC_ISSUER']) missingEnv.push('STELLAR_DEMO_EURC_ISSUER');
  if (missingEnv.length > 0) {
    console.log(`\n⚠️  Missing env vars: ${missingEnv.join(', ')}`);
    console.log('   Add these to apps/api/.env before starting the API:');
    console.log(`   STELLAR_DEMO_USDC_ISSUER=${state.usdcIssuer.publicKey}`);
    console.log(`   STELLAR_DEMO_EURC_ISSUER=${state.eurcIssuer.publicKey}`);
  }

  // ─── Company ────────────────────────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { slug: 'acme-stellar' },
    update: {},
    create: { name: 'Acme Stellar', slug: 'acme-stellar' },
  });
  console.log('\n✅ Company:', company.name, `(${company.id})`);

  // ─── Treasury (imported from setup-demo) ─────────────────────────────────
  // Import the pre-funded testnet treasury account so we don't need a fresh
  // wallet that would be empty (no XLM, no trustline, no USDC).
  const encryptedTreasurySecret = Buffer.from(state.treasury.secret, 'utf8').toString('base64');

  let treasury = await prisma.treasury.findFirst({
    where: { companyId: company.id, name: 'Stellar Treasury (testnet)' },
  });
  if (!treasury) {
    treasury = await prisma.treasury.create({
      data: {
        companyId: company.id,
        name: 'Stellar Treasury (testnet)',
        network: 'stellar-testnet',
        baseCurrency: 'USDC',
        walletAddress: state.treasury.publicKey,
        encryptedSecret: encryptedTreasurySecret,
        status: 'ACTIVE',
      },
    });
  } else {
    // Refresh the imported secret in case setup-demo was re-run with new accounts.
    treasury = await prisma.treasury.update({
      where: { id: treasury.id },
      data: {
        walletAddress: state.treasury.publicKey,
        encryptedSecret: encryptedTreasurySecret,
        status: 'ACTIVE',
      },
    });
  }
  console.log('✅ Treasury:', treasury.walletAddress, '(stellar-testnet)');

  // ─── Vendor + VendorWallet (from setup-demo) ─────────────────────────────
  // The vendor account from setup-demo already has an EURC trustline,
  // so it can receive EURC via path payment immediately.
  const vendor = await prisma.vendor.upsert({
    where: { companyId_name: { companyId: company.id, name: 'OpenAI EU' } },
    update: { walletAddress: state.vendor.publicKey, status: 'ACTIVE' },
    create: {
      companyId: company.id,
      name: 'OpenAI EU',
      walletAddress: state.vendor.publicKey,
      description: 'European AI inference vendor — receives in EURC',
      status: 'ACTIVE',
    },
  });

  await prisma.vendorWallet.upsert({
    where: {
      vendorId_network: { vendorId: vendor.id, network: 'stellar-testnet' },
    },
    update: {
      walletAddress: state.vendor.publicKey,
      trustedAssets: ['EURC'] as object,
    },
    create: {
      vendorId: vendor.id,
      network: 'stellar-testnet',
      walletAddress: state.vendor.publicKey,
      trustedAssets: ['EURC'] as object,
    },
  });
  console.log('✅ Vendor:', vendor.name, `→ ${state.vendor.publicKey} (EURC trustline ready)`);

  // ─── Agent ───────────────────────────────────────────────────────────────
  // The seed always generates a NEW API key so re-runs give the operator
  // a fresh key to use. Old agents are kept (audit history preserved).
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  const agent = await prisma.agent.create({
    data: {
      companyId: company.id,
      treasuryId: treasury.id,
      name: 'BR Marketing Bot (Stellar)',
      type: 'cross-border-procurement',
      ownerName: 'Growth Team BR',
      ownerEmail: 'growth@acme.com',
      status: 'ACTIVE',
      killSwitchActive: false,
      apiKeyHash,
    },
  });
  console.log('✅ Agent:', agent.name, `(${agent.id})`);

  // ─── Policy ──────────────────────────────────────────────────────────────
  await prisma.policy.create({
    data: {
      agentId: agent.id,
      name: 'Stellar Cross-Currency Policy',
      rules: {
        maxTransactionAmount: 100,
        requireApprovalAbove: 50,
        // Allow OpenAI EU + a few generic action types
        vendorAllowList: ['OpenAI EU'],
        allowedActionTypes: ['purchase_api_access', 'purchase_dataset', 'purchase_inference'],
      },
      active: true,
    },
  });

  await prisma.budget.upsert({
    where: { agentId: agent.id },
    update: { dailyLimit: 500, monthlyLimit: 5000, perTransactionLimit: 100 },
    create: {
      companyId: company.id,
      agentId: agent.id,
      dailyLimit: 500,
      monthlyLimit: 5000,
      perTransactionLimit: 100,
      currency: 'USDC',
    },
  });
  console.log('✅ Policy + Budget assigned');

  // ─── Admin User (idempotent) ─────────────────────────────────────────────
  const adminEmail = 'admin@acme-stellar.com';
  const passwordHash = await bcrypt.hash('aegis', 12);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash },
    create: {
      companyId: company.id,
      email: adminEmail,
      name: 'Admin',
      passwordHash,
      role: 'OWNER',
      notifyEmail: true,
      notifySms: false,
    },
  });
  console.log('✅ Admin user:', adminEmail);

  // ─── Output ──────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70));
  console.log('🎉 Stellar demo seed complete!');
  console.log('═'.repeat(70));
  console.log('\nAdd to apps/api/.env (if not yet present):');
  console.log(`STELLAR_DEMO_USDC_ISSUER=${state.usdcIssuer.publicKey}`);
  console.log(`STELLAR_DEMO_EURC_ISSUER=${state.eurcIssuer.publicKey}`);
  console.log('\nDashboard login (this company):');
  console.log(`  Email:    ${adminEmail}`);
  console.log('  Password: aegis');
  console.log('\nKey IDs:');
  console.log(`  Company:  ${company.id}`);
  console.log(`  Treasury: ${treasury.id} (${treasury.walletAddress})`);
  console.log(`  Vendor:   ${vendor.id} (${state.vendor.publicKey})`);
  console.log(`  Agent:    ${agent.id}`);
  console.log('\n📌 Agent API Key (use in Authorization: Bearer <key>):');
  console.log(`   ${apiKey}`);
  console.log('\n🚀 Test the cross-currency flow:');
  console.log('');
  console.log(
    `   curl 'http://localhost:3001/stellar/path-quote?sourceAsset=USDC&receiveAsset=EURC&amount=25&network=stellar-testnet&fromAccount=${treasury.walletAddress}'`,
  );
  console.log('');
  console.log('   curl -X POST http://localhost:3001/spend-requests \\');
  console.log(`     -H "Authorization: Bearer ${apiKey}" \\`);
  console.log('     -H "Content-Type: application/json" \\');
  console.log(
    '     -d \'{"actionType":"purchase_api_access","vendor":"OpenAI EU","amount":25,"currency":"USDC","receiveAsset":"EURC","reason":"GPT-4 credits para campanha BR"}\'',
  );
  console.log('');
  console.log('   # then execute:');
  console.log('   curl -X POST http://localhost:3001/spend-requests/<id>/execute \\');
  console.log(`     -H "Authorization: Bearer ${apiKey}"`);
  console.log('');
  console.log('═'.repeat(70) + '\n');
}

main()
  .catch((err) => {
    console.error('\n❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
