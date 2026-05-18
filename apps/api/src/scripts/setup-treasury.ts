/**
 * Setup treasury — script idempotente para preparar a hot wallet do MVP testnet.
 *
 * Fluxo:
 * 1. Carrega TREASURY_SECRET de env (se setado) OU gera nova keypair.
 * 2. Funda via Friendbot (se ainda não existe).
 * 3. Resolve issuer USDC via SEP-1 stellar.toml do test-anchor.
 * 4. Estabelece trustline USDC (idempotente via @aegis/stellar ensureTrustline).
 * 5. Upsert TreasuryAccount no DB.
 * 6. Se gerou keypair nova, imprime instruções pra colar no .env.local +
 *    sugere VENDOR_KEY_ENCRYPTION_KEY se ainda não configurada.
 *
 * Uso: pnpm --filter @aegis/api setup:treasury
 *
 * Segurança: NUNCA persiste o secret em DB (apenas o publicKey).
 */

import {
  createHorizonServer,
  ensureTrustline,
  findAnchorAssetIssuer,
  fundAccountTestnet,
  generateEncryptionKey,
  generateKeypair,
  loadTreasuryKey,
  resolveAsset,
  resolveNetwork,
} from '@aegis/stellar';
import { Network as PrismaNetwork, PrismaClient } from '@prisma/client';

import { env } from '../env.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const network = resolveNetwork(env.STELLAR_NETWORK, { horizonUrl: env.STELLAR_HORIZON_URL });
  if (network.kind !== 'testnet') {
    throw new Error(
      `setup-treasury suporta apenas testnet no MVP. STELLAR_NETWORK atual: ${network.kind}.`,
    );
  }

  console.log('\n🔧 Setup Treasury — Aegis Protocol');
  console.log(`   network=${network.kind} horizon=${network.horizonUrl}\n`);

  // ===== Passo 1 — Keypair =====
  let keypair;
  let generated = false;
  try {
    keypair = loadTreasuryKey(env.TREASURY_SECRET).keypair;
    console.log(`🔑 TREASURY_SECRET detectado: ${keypair.publicKey()}`);
  } catch {
    keypair = generateKeypair().keypair;
    generated = true;
    console.log(`🔑 TREASURY_SECRET não configurado — gerando nova keypair...`);
    console.log(`   publicKey: ${keypair.publicKey()}`);
    console.log(`   secret:    ${keypair.secret()}`);
  }

  const horizon = createHorizonServer(network);

  // ===== Passo 2 — Friendbot funding =====
  console.log('\n💧 Friendbot funding...');
  const fundResult = await fundAccountTestnet(network, keypair.publicKey());
  console.log(`   ${fundResult.reason}${fundResult.message ? ` (${fundResult.message})` : ''}`);

  // ===== Passo 3 — Resolver USDC via TOML =====
  console.log(`\n📜 Resolvendo USDC issuer via ${env.SEP24_ANCHOR_HOME_DOMAIN}/.well-known/stellar.toml...`);
  const usdcIssuer = await findAnchorAssetIssuer(env.SEP24_ANCHOR_HOME_DOMAIN, 'USDC');
  if (!usdcIssuer) {
    throw new Error(
      `USDC não encontrado no TOML de ${env.SEP24_ANCHOR_HOME_DOMAIN}. ` +
        `Verifique CURRENCIES no stellar.toml.`,
    );
  }
  console.log(`   USDC issuer: ${usdcIssuer}`);

  const usdcAsset = await resolveAsset('USDC', network.kind, env.SEP24_ANCHOR_HOME_DOMAIN);

  // ===== Passo 4 — Trustline USDC =====
  console.log('\n🔗 Verificando trustline USDC...');
  const trustResult = await ensureTrustline({ horizon, network, keypair, asset: usdcAsset });
  if (trustResult.alreadyExisted) {
    console.log('   ✓ trustline USDC já existe — nada a fazer');
  } else {
    console.log(`   ✓ trustline criada: txHash=${trustResult.txHash}`);
    console.log(`     ${network.stellarExpertBase}/tx/${trustResult.txHash}`);
  }

  // ===== Passo 5 — Upsert TreasuryAccount no DB =====
  console.log('\n💾 Persistindo TreasuryAccount...');
  const existingTreasury = await prisma.treasuryAccount.findFirst({
    where: { network: PrismaNetwork.TESTNET },
  });
  if (existingTreasury) {
    if (existingTreasury.publicKey !== keypair.publicKey()) {
      await prisma.treasuryAccount.update({
        where: { id: existingTreasury.id },
        data: { publicKey: keypair.publicKey(), secretKeyEnvVar: 'TREASURY_SECRET' },
      });
      console.log(`   ✓ TreasuryAccount atualizado: ${keypair.publicKey()}`);
    } else {
      console.log(`   ✓ TreasuryAccount já existe: ${keypair.publicKey()}`);
    }
  } else {
    await prisma.treasuryAccount.create({
      data: {
        publicKey: keypair.publicKey(),
        network: PrismaNetwork.TESTNET,
        secretKeyEnvVar: 'TREASURY_SECRET',
      },
    });
    console.log(`   ✓ TreasuryAccount criado: ${keypair.publicKey()}`);
  }

  // ===== Passo 6 — Balances finais =====
  console.log('\n💰 Balances finais:');
  const refreshed = await horizon.loadAccount(keypair.publicKey());
  for (const b of refreshed.balances) {
    if (b.asset_type === 'native') {
      console.log(`   XLM:  ${b.balance}`);
    } else if ('asset_code' in b && 'asset_issuer' in b) {
      console.log(`   ${b.asset_code}: ${b.balance}  (issuer=${b.asset_issuer})`);
    }
  }
  console.log(`   ${network.stellarExpertBase}/account/${keypair.publicKey()}`);

  // ===== Passo 7 — Instruções finais =====
  if (generated || !env.VENDOR_KEY_ENCRYPTION_KEY) {
    console.log('\n⚠  Atualize apps/api/.env.local com:\n');
    if (generated) {
      console.log(`TREASURY_PUBLIC_KEY=${keypair.publicKey()}`);
      console.log(`TREASURY_SECRET=${keypair.secret()}`);
      console.log(`USDC_ASSET_ISSUER=${usdcIssuer}`);
    }
    if (!env.VENDOR_KEY_ENCRYPTION_KEY) {
      console.log(`VENDOR_KEY_ENCRYPTION_KEY=${generateEncryptionKey()}`);
    }
    console.log();
  }

  console.log('✅ Treasury pronta.\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Setup falhou:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
