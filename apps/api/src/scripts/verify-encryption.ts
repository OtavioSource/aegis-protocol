/**
 * Script de validação — confirma round-trip de encryption:
 * 1. Lê última VendorWallet do DB
 * 2. Decifra secretKeyEncrypted com VENDOR_KEY_ENCRYPTION_KEY
 * 3. Verifica que decifrado é um secret Stellar válido (S...)
 * 4. Deriva publicKey do secret e compara com publicKey persistida
 *
 * Uso: pnpm --filter @aegis/api exec dotenv -e .env.local -- tsx src/scripts/verify-encryption.ts
 */

import { decryptSecret, publicKeyFromSecret } from '@aegis/stellar';
import { PrismaClient } from '@prisma/client';

import { env } from '../env.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (!env.VENDOR_KEY_ENCRYPTION_KEY) {
    throw new Error('VENDOR_KEY_ENCRYPTION_KEY not set');
  }

  const wallet = await prisma.vendorWallet.findFirst({
    where: { secretKeyEncrypted: { not: null } },
    orderBy: { createdAt: 'desc' },
    include: { vendor: true },
  });

  if (!wallet || !wallet.secretKeyEncrypted) {
    console.log('Nenhuma VendorWallet com secretKeyEncrypted encontrada.');
    return;
  }

  console.log(`📋 Vendor: ${wallet.vendor.name} (${wallet.id})`);
  console.log(`   publicKey: ${wallet.publicKey}`);
  console.log(`   secretKeyEncrypted (DB): ${wallet.secretKeyEncrypted.slice(0, 60)}...`);

  // Confirma formato AES-256-GCM: iv:authTag:ciphertext em hex
  const parts = wallet.secretKeyEncrypted.split(':');
  console.log(`   formato: ${parts.length} partes (esperado 3: iv:authTag:cipher)`);

  // Decifra
  const decrypted = decryptSecret(wallet.secretKeyEncrypted, env.VENDOR_KEY_ENCRYPTION_KEY);
  console.log(`   decifrado: ${decrypted.slice(0, 6)}…${decrypted.slice(-4)} (${decrypted.length} chars)`);
  console.log(`   formato secret Stellar válido: ${decrypted.startsWith('S') && decrypted.length === 56}`);

  // Deriva publicKey e compara
  const derivedPublicKey = publicKeyFromSecret(decrypted);
  const matches = derivedPublicKey === wallet.publicKey;
  console.log(`   publicKey derivada bate com o DB: ${matches ? '✓ SIM' : '✗ NÃO'}`);

  if (!matches) {
    throw new Error('publicKey decifrada não bate — encryption corrompida ou key trocada');
  }

  // Teste tamper: muda 1 caractere e tenta decifrar (deve falhar)
  console.log('\n🔐 Teste de tamper-detection (AES-GCM authTag):');
  const tampered = wallet.secretKeyEncrypted.slice(0, -2) + 'ff';
  try {
    decryptSecret(tampered, env.VENDOR_KEY_ENCRYPTION_KEY);
    console.log('   ✗ FALHA — decifrou mensagem alterada (authTag não validou)');
  } catch (e) {
    console.log(`   ✓ tamper detectado: ${(e as Error).message.slice(0, 60)}`);
  }

  // Teste key errada
  console.log('\n🔑 Teste com VENDOR_KEY_ENCRYPTION_KEY errada:');
  const wrongKey = 'a'.repeat(64);
  try {
    decryptSecret(wallet.secretKeyEncrypted, wrongKey);
    console.log('   ✗ FALHA — decifrou com key errada');
  } catch (e) {
    console.log(`   ✓ rejeitou key errada: ${(e as Error).message.slice(0, 60)}`);
  }

  console.log('\n✅ Encryption validada.');
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
