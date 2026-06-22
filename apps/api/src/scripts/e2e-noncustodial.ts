/**
 * Teste end-to-end do modelo não-custodial (ADR 0007) contra a testnet + DB.
 *
 * Sobe o app real (buildApp) e exercita as rotas via fastify.inject():
 *   agente → carteira (GENERATED) → setup multisig on-chain → spend-request
 *   → agente assina o envelope → /cosign (co-assina + submete).
 *
 * Cria dados efêmeros (company/user/policy) e os remove no fim. O setup multisig
 * é uma transação REAL na testnet. O pagamento final fica verde se a treasury
 * tiver USDC para financiar a carteira; senão falha com erro limpo do Horizon
 * (o que ainda prova que toda a fiação está correta).
 *
 * Rodar: pnpm --filter @aegis/api exec dotenv -e .env.local -- tsx src/scripts/e2e-noncustodial.ts
 */

import { randomUUID } from 'node:crypto';

import { generateKeypairStrings, signTransactionXdr } from '@aegis/stellar';

import { buildApp } from '../app.js';
import { mintSessionToken } from '../lib/session-token.js';

let pass = 0;
let fail = 0;
function check(cond: boolean, label: string, extra?: unknown) {
  if (cond) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.log(`  ❌ ${label}`, extra ?? '');
    fail++;
  }
}

async function main() {
  const app = await buildApp();
  const prisma = app.prisma;

  const stamp = Date.now();
  const company = await prisma.company.create({
    data: { name: 'E2E Test Co', slug: `e2e-${stamp}` },
  });
  const user = await prisma.user.create({
    data: { companyId: company.id, email: `e2e-${stamp}@test.local`, name: 'E2E', role: 'OWNER' },
  });
  const policy = await prisma.policy.create({
    data: {
      companyId: company.id,
      name: 'E2E Policy',
      version: 1,
      isActive: true,
      rules: {
        maxPerTransactionCents: null,
        monthlyBudgetCents: null,
        vendorAllowList: [],
        vendorDenyList: [],
        actionTypes: [],
        maxSpendPerHourCents: null,
        maxPaymentsPerHour: null,
        humanApprovalThresholdCents: null,
      },
    },
  });

  const token = mintSessionToken({
    sub: user.id,
    companyId: company.id,
    role: 'OWNER',
    email: user.email,
  });
  const auth = { authorization: `Bearer ${token}` };

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<{ status: number; body: any }> {
    const res = await app.inject({ method, url, headers: { ...auth, ...extraHeaders }, payload: payload as object });
    let body: unknown;
    try {
      body = res.json();
    } catch {
      body = res.body;
    }
    return { status: res.statusCode, body };
  }

  console.log('\n=== E2E não-custodial (testnet) ===\n');

  try {
    // 1. Criar agente (gera signer keypair)
    const agentRes = await call('POST', '/v1/agents', {
      name: 'E2E Agent',
      activePolicyId: policy.id,
    });
    check(agentRes.status === 201, 'POST /v1/agents → 201', agentRes.body);
    const agentId = agentRes.body.id as string;
    const signerSecret = agentRes.body.signerSecret as string;
    check(!!signerSecret && !!agentRes.body.signerPubKey, 'agente recebeu signerSecret + signerPubKey');

    // 2. Gerar a master do dono — SEM friendbot. A conta nasce com 0 XLM
    //    (modo GENERATED real). O setup cria a conta sponsorizada e o pagamento
    //    usa fee-bump pago pelo Aegis, então a carteira nunca precisa de XLM.
    const owner = generateKeypairStrings();
    check(true, `owner GENERATED (0 XLM, fee-bump pelo Aegis): ${owner.publicKey.slice(0, 8)}…`);

    // 3. Criar carteira (modo GENERATED — só a pubkey vai à API)
    const walletRes = await call('POST', '/v1/wallets', {
      label: 'E2E Wallet',
      ownerKeyMode: 'GENERATED',
      address: owner.publicKey,
    });
    check(walletRes.status === 201, 'POST /v1/wallets → 201', walletRes.body);
    const walletId = walletRes.body.id as string;
    check(
      walletRes.body.aegisSignerPubKey?.startsWith('G'),
      'carteira recebeu aegisSignerPubKey derivada',
    );

    // 4. Atribuir o agente à carteira
    const patchRes = await call('PATCH', `/v1/agents/${agentId}`, { walletId });
    check(patchRes.status === 200 && patchRes.body.walletId === walletId, 'PATCH agente → walletId');

    // 5. Setup multisig (monta tx; dono assina; submete)
    const setupRes = await call('POST', `/v1/wallets/${walletId}/setup`, { openUsdcTrustline: true });
    check(setupRes.status === 200 && !!setupRes.body.setupXdr, 'POST setup → setupXdr', setupRes.body);
    const signedSetup = signTransactionXdr(
      setupRes.body.setupXdr,
      owner.secret,
      setupRes.body.networkPassphrase,
    );
    const submitRes = await call('POST', `/v1/wallets/${walletId}/setup/submit`, {
      signedXdr: signedSetup,
    });
    check(
      submitRes.status === 200 && submitRes.body.status === 'ACTIVE',
      'POST setup/submit → carteira ACTIVE (multisig on-chain)',
      submitRes.body,
    );
    console.log(`     setupTx: ${submitRes.body.setupTxHash}`);

    // 6. Criar vendor + sponsor wallet (USDC trustline)
    const vendorRes = await call('POST', '/v1/vendors', { name: 'E2E Vendor', preferredAsset: 'USDC' });
    check(vendorRes.status === 201, 'POST /v1/vendors → 201', vendorRes.body);
    const vendorId = vendorRes.body.id as string;
    const sponsorRes = await call('POST', `/v1/vendors/${vendorId}/wallets/sponsor`);
    check(sponsorRes.status < 300, 'POST sponsor wallet do vendor', sponsorRes.body);

    // 7. (oportunista) financiar a carteira com USDC da treasury, se houver
    let usdcFunded = false;
    try {
      const bal = await app.stellar.getTreasuryBalance('USDC');
      const cents = bal.amountCents ?? 0;
      if (cents >= 100) {
        await app.stellar.executePayment({
          destinationPublicKey: owner.publicKey,
          amountCents: 100,
          destAssetCode: 'USDC',
        });
        usdcFunded = true;
        console.log('     treasury financiou 1.00 USDC na carteira de teste');
      } else {
        console.log(`     treasury sem USDC suficiente (${cents}c) — pagamento final deve falhar limpo`);
      }
    } catch (e) {
      console.log('     fund USDC pulado:', (e as Error).message);
    }

    // 8. Spend-request → AWAITING_AGENT_SIGNATURE + envelope
    const srRes = await call(
      'POST',
      '/v1/spend-requests',
      // Caller é um usuário (session token) → agentId é obrigatório ("act as agent").
      { agentId, vendorId, amountCents: 50, asset: 'USDC', actionType: 'api-call', reason: 'e2e' },
      { 'idempotency-key': randomUUID() },
    );
    check(
      srRes.status === 201 &&
        srRes.body.status === 'AWAITING_AGENT_SIGNATURE' &&
        !!srRes.body.envelopeXdr,
      'POST /v1/spend-requests → AWAITING_AGENT_SIGNATURE + envelopeXdr',
      srRes.body,
    );
    const srId = srRes.body.id as string;

    if (srRes.body.envelopeXdr) {
      // 9. Agente assina o envelope e co-assina via /cosign
      const signedEnv = signTransactionXdr(
        srRes.body.envelopeXdr,
        signerSecret,
        srRes.body.networkPassphrase,
      );
      const cosignRes = await call('POST', `/v1/spend-requests/${srId}/cosign`, {
        signedXdr: signedEnv,
      });
      const st = cosignRes.body.status;
      console.log(`     /cosign → HTTP ${cosignRes.status}, status=${st}, tx=${cosignRes.body.txHash ?? '—'}, fail=${cosignRes.body.failureReason ?? '—'}`);

      if (usdcFunded) {
        check(st === 'EXECUTED' && !!cosignRes.body.txHash, '/cosign → EXECUTED (pagamento on-chain)');
      } else {
        // Sem USDC: deve falhar com erro de saldo do Horizon (não erro de código).
        const reason = String(cosignRes.body.failureReason ?? '');
        check(
          st === 'EXECUTION_FAILED' && /Horizon|tx_|op_/.test(reason),
          '/cosign → EXECUTION_FAILED com erro limpo do Horizon (fiação ok)',
          reason,
        );
      }

      // 10. Negativo: cosign de novo deve ser noop/409 (estado já avançou)
      const cosignAgain = await call('POST', `/v1/spend-requests/${srId}/cosign`, { signedXdr: signedEnv });
      check(cosignAgain.status === 409, 'cosign repetido → 409 (lock/idempotência)', cosignAgain.body);
    }
  } finally {
    // Limpeza dos dados efêmeros (cascade a partir da company)
    try {
      await prisma.company.delete({ where: { id: company.id } });
      console.log('\n🧹 dados efêmeros removidos');
    } catch (e) {
      console.log('\n⚠ limpeza falhou:', (e as Error).message);
    }
    await app.close();
  }

  console.log(`\n=== RESULTADO: ${pass} ok, ${fail} falhas ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ e2e erro não tratado:', err);
  process.exit(1);
});
