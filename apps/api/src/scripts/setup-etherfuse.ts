/**
 * Setup Etherfuse — smoke test + descoberta de configs da org.
 *
 * Modelo de integração do Aegis:
 *  - A ORG Etherfuse é criada uma vez via signup no dashboard (devnet.etherfuse.com),
 *    que faz o KYB. A API key (`api_sand:...:<orgId>`) já carrega o orgId.
 *  - O Aegis então só precisa: (1) registrar a crypto wallet da treasury e
 *    (2) usar uma bank account ativa da org. Não há onboarding de customer
 *    programático — a org já existe e está KYB-aprovada.
 *
 * O que esse script faz:
 *  1. Valida ETHERFUSE_API_KEY + TREASURY_PUBLIC_KEY
 *  2. GET /ramp/assets (smoke test BRL)
 *  3. Garante a treasury wallet registrada (POST /ramp/wallet se faltar)
 *  4. Lista bank accounts e escolhe uma ativa+compliant
 *  5. Imprime os valores para colar no apps/api/.env.local
 *
 * Uso: pnpm --filter @aegis/api setup:etherfuse
 */

import { EtherfuseClient } from '@aegis/stellar';

import { env } from '../env.js';

async function main(): Promise<void> {
  console.log('\n🔧 Setup Etherfuse — Aegis Protocol\n');

  if (!env.ETHERFUSE_API_KEY || env.ETHERFUSE_API_KEY.endsWith('REPLACE_ME')) {
    console.error('❌ ETHERFUSE_API_KEY não configurada no apps/api/.env.local');
    console.error('   Cadastre em https://devnet.etherfuse.com e crie uma API key.');
    process.exit(1);
  }
  if (!env.TREASURY_PUBLIC_KEY) {
    console.error('❌ TREASURY_PUBLIC_KEY não configurada. Rode `setup:treasury` primeiro.');
    process.exit(1);
  }

  const client = new EtherfuseClient({
    baseUrl: env.ETHERFUSE_BASE_URL,
    apiKey: env.ETHERFUSE_API_KEY,
  });

  console.log(`   baseUrl=${env.ETHERFUSE_BASE_URL}`);
  console.log(`   sandbox=${client.isSandbox}`);
  console.log(`   treasury=${env.TREASURY_PUBLIC_KEY}\n`);

  // Passo 1: smoke test GET /ramp/assets (BRL)
  console.log('📋 GET /ramp/assets?blockchain=stellar&currency=BRL&wallet=<treasury>');
  try {
    const assets = await client.listAssets({
      blockchain: 'stellar',
      currency: 'BRL',
      wallet: env.TREASURY_PUBLIC_KEY,
    });
    console.log(`   ✓ ${assets.assets.length} assets retornados:`);
    for (const a of assets.assets) {
      console.log(`   • ${a.symbol.padEnd(10)} ${a.identifier}`);
    }
  } catch (err) {
    console.error(`❌ Falhou: ${(err as Error).message}`);
    console.error('   Verifique se a API key está correta e ativa em devnet.etherfuse.com.');
    process.exit(1);
  }

  // Passo 2: garante a treasury wallet registrada na org
  console.log('\n👛 Crypto wallet (treasury):');
  let wallet = (await client.listWallets()).find(
    (w) => w.publicKey === env.TREASURY_PUBLIC_KEY,
  );
  if (wallet) {
    console.log(`   ✓ wallet já registrada — walletId=${wallet.walletId}`);
  } else {
    console.log('   wallet ausente — registrando via POST /ramp/wallet...');
    wallet = await client.registerWallet(env.TREASURY_PUBLIC_KEY);
    console.log(`   ✓ wallet registrada — walletId=${wallet.walletId}`);
  }
  if (wallet.kycStatus && wallet.kycStatus !== 'approved') {
    console.log(`   ⚠ kycStatus=${wallet.kycStatus} (esperado "approved" para criar orders)`);
  }
  const customerId = wallet.customerId;
  console.log(`   orgId (customerId) = ${customerId}`);

  // Passo 3: bank accounts da org
  console.log('\n🏦 Bank accounts:');
  const accounts = await client.listBankAccounts();
  if (accounts.length === 0) {
    console.warn('   ⚠ Nenhuma bank account encontrada.');
    console.warn('   Crie uma conta BRL (Pix) no dashboard Etherfuse → Ramp → Bank Accounts.');
  }
  for (const a of accounts) {
    const ready = a.status === 'active' && a.compliant;
    console.log(
      `   ${ready ? '✓' : '•'} ${a.bankAccountId}  currency=${a.currency ?? 'n/a'} ` +
        `status=${a.status ?? 'n/a'} compliant=${a.compliant ?? 'n/a'} label="${a.label ?? ''}"`,
    );
  }
  const usable = accounts.find((a) => a.status === 'active' && a.compliant);

  // Passo 4: valores para o .env.local
  console.log('\n⚠  Cole/confirme no apps/api/.env.local:');
  console.log(`   ETHERFUSE_CUSTOMER_ID=${customerId}`);
  if (usable) {
    console.log(`   ETHERFUSE_BANK_ACCOUNT_ID=${usable.bankAccountId}`);
  } else {
    console.log('   ETHERFUSE_BANK_ACCOUNT_ID=<crie uma conta ativa+compliant no dashboard>');
  }

  console.log('\n✅ Smoke test Etherfuse OK.\n');
  console.log('Próximo passo:');
  console.log('   POST /v1/fiat/deposits {');
  console.log('     "provider": "etherfuse",');
  console.log('     "sourceAsset": "BRL",            // Etherfuse aceita BRL ou MXN');
  console.log('     "sourceAmountCents": 2500,        // R$ 25');
  console.log('     "asset": "USDC",');
  console.log('     "targetAssetIdentifier": "<identifier descoberto acima>"');
  console.log('   }');
  console.log('   Sandbox: POST /v1/fiat/deposits/:id/simulate para simular o Pix recebido.\n');
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
