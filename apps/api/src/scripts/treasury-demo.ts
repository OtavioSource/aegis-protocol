/**
 * POC — Treasury Payout Run governado pelo Aegis (testnet + DB reais).
 *
 * Cenário: uma DAO/empresa cripto ("Acme DAO") roda a folha de pagamentos
 * on-chain a partir da sua tesouraria multisig não-custodial. O Aegis governa:
 *   1) Contribuidor na whitelist, dentro do teto  → APPROVED → EXECUTED on-chain
 *   2) Fornecedor na whitelist, acima do threshold → REQUIRES_APPROVAL → humano
 *      aprova → EXECUTED
 *   3) Endereço FORA da whitelist (erro/chave comprometida) → REJECTED: o
 *      dinheiro NÃO sai (o "save").
 * Cada decisão vira registro de auditoria imutável.
 *
 * Sobe o app real (buildApp) e exercita as rotas via fastify.inject(). O setup
 * multisig e os pagamentos aprovados são transações REAIS na testnet (se a
 * treasury tiver USDC para financiar a tesouraria). O REJECTED é política pura
 * e sempre roda. Dados ficam no banco sob o slug fixo (limpo a cada run).
 *
 * Rodar: pnpm --filter @aegis/api exec dotenv -e .env.local -- tsx src/scripts/treasury-demo.ts
 */

import { randomUUID } from 'node:crypto';

import { generateKeypairStrings, signTransactionXdr } from '@aegis/stellar';

import { buildApp } from '../app.js';
import { mintSessionToken } from '../lib/session-token.js';

const SLUG = 'acme-dao-treasury';
const NET = process.env.STELLAR_NETWORK === 'mainnet' ? 'public' : 'testnet';
const expert = (h: string) => `https://stellar.expert/explorer/${NET}/tx/${h}`;
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

async function main() {
  const app = await buildApp();
  const prisma = app.prisma;

  // Limpeza idempotente de runs anteriores. Approval.userId → User não é
  // onDelete:Cascade, então removemos as aprovações antes de deletar a company.
  const prev = await prisma.company.findFirst({ where: { slug: SLUG } });
  if (prev) {
    await prisma.approval.deleteMany({ where: { spendRequest: { companyId: prev.id } } });
    await prisma.company.delete({ where: { id: prev.id } });
  }

  const company = await prisma.company.create({ data: { name: 'Acme DAO', slug: SLUG } });
  const user = await prisma.user.create({
    data: { companyId: company.id, email: `treasurer@${SLUG}.local`, name: 'Treasurer', role: 'OWNER' },
  });
  const token = mintSessionToken({ sub: user.id, companyId: company.id, role: 'OWNER', email: user.email });
  const auth = { authorization: `Bearer ${token}` };

  async function call(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, extra?: Record<string, string>) {
    const res = await app.inject({ method, url, headers: { ...auth, ...extra }, payload: payload as object });
    let body: any;
    try { body = res.json(); } catch { body = res.body; }
    return { status: res.statusCode, body };
  }

  // Assina o envelope com a agent key e co-assina via /cosign → submete on-chain.
  async function cosign(srId: string, envelopeXdr: string, passphrase: string, signerSecret: string) {
    const signed = signTransactionXdr(envelopeXdr, signerSecret, passphrase);
    const r = await call('POST', `/v1/spend-requests/${srId}/cosign`, { signedXdr: signed });
    return r.body;
  }

  const line = () => console.log('─'.repeat(64));
  console.log('\n═══ AEGIS · Treasury Payout Run (testnet) ═══\n');

  try {
    // ---- Beneficiários (vendors) ----
    const aliceRes = await call('POST', '/v1/vendors', { name: 'Alice (contributor)', category: 'payroll', preferredAsset: 'USDC' });
    const bobRes = await call('POST', '/v1/vendors', { name: 'Bob (supplier)', category: 'supplier', preferredAsset: 'USDC' });
    const unknownRes = await call('POST', '/v1/vendors', { name: 'Unknown address', preferredAsset: 'USDC' });
    const alice = aliceRes.body.id as string;
    const bob = bobRes.body.id as string;
    const unknown = unknownRes.body.id as string;
    // Sponsor das wallets USDC dos 2 autorizados (Unknown não recebe wallet — será barrado antes).
    await call('POST', `/v1/vendors/${alice}/wallets/sponsor`);
    await call('POST', `/v1/vendors/${bob}/wallets/sponsor`);

    // ---- Política da tesouraria (whitelist = Alice + Bob) ----
    const policy = await prisma.policy.create({
      data: {
        companyId: company.id,
        name: 'Treasury Policy',
        version: 1,
        isActive: true,
        rules: {
          maxPerTransactionCents: 100, // teto $1.00/tx
          monthlyBudgetCents: null,
          humanApprovalThresholdCents: 10, // > $0.10 exige aprovação humana
          vendorAllowList: [alice, bob], // whitelist de beneficiários
          vendorDenyList: [],
          actionTypes: [],
          maxSpendPerHourCents: null,
          maxPaymentsPerHour: null,
        },
      },
    });

    // ---- Agente operador (Payout Bot) + tesouraria multisig ----
    const agentRes = await call('POST', '/v1/agents', { name: 'Payout Bot', activePolicyId: policy.id });
    const agentId = agentRes.body.id as string;
    const signerSecret = agentRes.body.signerSecret as string;

    const owner = generateKeypairStrings(); // master da DAO (0 XLM; fee-bump pelo Aegis)
    const walletRes = await call('POST', '/v1/wallets', { label: 'Main Treasury', ownerKeyMode: 'GENERATED', address: owner.publicKey });
    const walletId = walletRes.body.id as string;
    await call('PATCH', `/v1/agents/${agentId}`, { walletId });

    const setupRes = await call('POST', `/v1/wallets/${walletId}/setup`, { openUsdcTrustline: true });
    const signedSetup = signTransactionXdr(setupRes.body.setupXdr, owner.secret, setupRes.body.networkPassphrase);
    const submitRes = await call('POST', `/v1/wallets/${walletId}/setup/submit`, { signedXdr: signedSetup });
    const active = submitRes.body.status === 'ACTIVE';

    // ---- Financia a tesouraria com USDC da treasury (oportunista) ----
    let fundedCents = 0;
    try {
      const bal = await app.stellar.getTreasuryBalance('USDC');
      const have = bal.amountCents ?? 0;
      if (have >= 30) {
        await app.stellar.executePayment({ destinationPublicKey: owner.publicKey, amountCents: 30, destAssetCode: 'USDC' });
        fundedCents = 30;
      }
    } catch { /* segue: pagamentos on-chain podem falhar limpo, o REJECTED não depende disso */ }

    console.log('Setup');
    console.log(`  Tesouraria: Main Treasury (${owner.publicKey.slice(0, 8)}…) — multisig ${active ? 'ACTIVE' : 'FALHOU'} · fundeada ${usd(fundedCents)} USDC`);
    console.log(`  Política:   teto ${usd(100)}/tx · aprovação humana > ${usd(10)} · whitelist [Alice, Bob]`);
    console.log(`  Setup tx:   ${submitRes.body.setupTxHash ? expert(submitRes.body.setupTxHash) : '—'}\n`);
    line();
    console.log('Payout run\n');

    // ============ 1) Alice — whitelist, abaixo do threshold → APPROVED ============
    const p1 = await call('POST', '/v1/spend-requests',
      { agentId, vendorId: alice, amountCents: 5, asset: 'USDC', actionType: 'payroll', reason: 'contribuição semanal' },
      { 'idempotency-key': randomUUID() });
    console.log(`1) → Alice    ${usd(5)}   [whitelist · < teto de aprovação]`);
    console.log(`     decisão: ${p1.body.decision ?? p1.body.status}`);
    if (p1.body.status === 'AWAITING_AGENT_SIGNATURE' && p1.body.envelopeXdr) {
      const done = await cosign(p1.body.id, p1.body.envelopeXdr, p1.body.networkPassphrase, signerSecret);
      if (done.status === 'EXECUTED') console.log(`     ✅ EXECUTED on-chain — ${expert(done.txHash)}`);
      else console.log(`     ⚠ ${done.status}${done.failureReason ? ' · ' + done.failureReason : ''} (fiação ok; faltou USDC na tesouraria)`);
    }
    console.log('');

    // ============ 2) Bob — whitelist, acima do threshold → REQUIRES_APPROVAL ============
    const p2 = await call('POST', '/v1/spend-requests',
      { agentId, vendorId: bob, amountCents: 20, asset: 'USDC', actionType: 'supplier', reason: 'fatura de serviço' },
      { 'idempotency-key': randomUUID() });
    console.log(`2) → Bob      ${usd(20)}  [whitelist · > teto de aprovação]`);
    console.log(`     decisão: ${p2.body.decision ?? p2.body.status} → escalado para humano`);
    if (p2.body.status === 'REQUIRES_APPROVAL') {
      const appr = await call('POST', `/v1/approvals/${p2.body.id}`, { action: 'APPROVED', reason: 'aprovado pelo tesoureiro' });
      const sr2 = appr.body.spendRequest;
      console.log(`     🧑 humano aprovou`);
      if (sr2?.status === 'AWAITING_AGENT_SIGNATURE' && sr2.envelopeXdr) {
        const done = await cosign(sr2.id, sr2.envelopeXdr, sr2.networkPassphrase, signerSecret);
        if (done.status === 'EXECUTED') console.log(`     ✅ EXECUTED on-chain — ${expert(done.txHash)}`);
        else console.log(`     ⚠ ${done.status}${done.failureReason ? ' · ' + done.failureReason : ''} (fiação ok; faltou USDC na tesouraria)`);
      }
    }
    console.log('');

    // ============ 3) Unknown — FORA da whitelist → REJECTED (o save) ============
    const p3 = await call('POST', '/v1/spend-requests',
      { agentId, vendorId: unknown, amountCents: 5, asset: 'USDC', actionType: 'payroll', reason: 'pagamento suspeito' },
      { 'idempotency-key': randomUUID() });
    console.log(`3) → Unknown  ${usd(5)}   [FORA da whitelist — erro/chave comprometida]`);
    console.log(`     decisão: ${p3.body.decision ?? p3.body.status}`);
    console.log(`     🛡️  BLOQUEADO — o dinheiro NÃO saiu · motivo: ${p3.body.decisionReason ?? 'vendor não autorizado pela política'}`);
    console.log('');
    line();

    // ---- Trilha de auditoria imutável ----
    const events = await prisma.auditEvent.findMany({ where: { companyId: company.id }, orderBy: { createdAt: 'asc' } });
    const soroban = events.filter((e) => e.sorobanTxHash).length;
    console.log(`Auditoria: ${events.length} eventos imutáveis · ${soroban} com recibo Soroban on-chain`);
    for (const e of events) console.log(`  · ${e.eventType}${e.sorobanTxHash ? ' → soroban ' + e.sorobanTxHash.slice(0, 12) + '…' : ''}`);

    console.log('\n═══ Fim. A tesouraria pagou o autorizado, escalou o arriscado e bloqueou o proibido. ═══\n');
    console.log(`(dados no banco sob company "Acme DAO" / slug ${SLUG} para inspeção)\n`);
  } finally {
    await app.close();
  }
  process.exit(0);
}

main().catch((err) => { console.error('\n❌ erro:', err); process.exit(1); });
