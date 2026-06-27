/**
 * PROTÓTIPO 2 (ADR 0007) — valida os helpers reais do @aegis/stellar na testnet:
 *   - deriveAegisSigner (HKDF por company)
 *   - buildWalletSetupTransaction (setOptions + thresholds + sponsoring CAP-33)
 *
 * Modo A (GENERATED): o sponsor (conta operacional do Aegis) cria a conta do
 * dono e patrocina as reserves; o dono assina client-side; submete-se.
 *
 * Rodar:
 *   pnpm --filter @aegis/api exec tsx ../../packages/stellar/scripts/proto-multisig-setup.ts
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import {
  buildPaymentEnvelope,
  buildWalletSetupTransaction,
  cosignAndSubmitPayment,
  createHorizonServer,
  deriveAegisSigner,
  resolveNetwork,
  validatePaymentEnvelope,
  WALLET_MASTER_WEIGHT,
} from '../src/index.js';

const network = resolveNetwork('testnet');
const horizon = createHorizonServer(network);
const EXPERT = network.stellarExpertBase;

function log(...a: unknown[]) {
  console.log(...a);
}
function assert(cond: boolean, msg: string) {
  if (!cond) {
    log(`\n❌ ASSERÇÃO: ${msg}`);
    process.exit(1);
  }
}
function codesOf(err: unknown): string {
  const e = err as {
    response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } };
    message?: string;
  };
  const c = e?.response?.data?.extras?.result_codes;
  if (c) return `${c.transaction ?? ''} ops=[${(c.operations ?? []).join(',')}]`;
  return e?.message ?? 'erro desconhecido';
}
async function friendbot(pub: string) {
  const res = await fetch(`${network.friendbotUrl}?addr=${encodeURIComponent(pub)}`);
  if (!res.ok && res.status !== 400) throw new Error(`friendbot ${res.status}`);
}
async function submit(label: string, signers: Keypair[], xdr: string): Promise<boolean> {
  const tx = TransactionBuilder.fromXDR(xdr, network.passphrase);
  for (const s of signers) tx.sign(s);
  try {
    const r = await horizon.submitTransaction(tx);
    log(`  ✅ ${label} → ${r.hash}`);
    return true;
  } catch (err) {
    log(`  ⛔ ${label} → ${codesOf(err)}`);
    return false;
  }
}

async function main() {
  log('=== PROTÓTIPO 2 — helpers de setup multisig (testnet) ===\n');

  // --- Derivação: determinismo + isolamento por company ---
  const root = randomBytes(32).toString('hex');
  const companyA = randomUUID();
  const companyB = randomUUID();
  const aegisA1 = deriveAegisSigner(root, companyA).publicKey();
  const aegisA2 = deriveAegisSigner(root, companyA).publicKey();
  const aegisB = deriveAegisSigner(root, companyB).publicKey();
  log('Derivação HKDF:');
  log(`  company A → ${aegisA1}`);
  log(`  company B → ${aegisB}`);
  assert(aegisA1 === aegisA2, 'derivação deve ser determinística para a mesma company');
  assert(aegisA1 !== aegisB, 'companies diferentes devem derivar chaves diferentes');
  log('  ✅ determinístico por company e isolado entre companies\n');

  // --- Atores ---
  const sponsor = Keypair.random(); // conta operacional do Aegis
  const owner = Keypair.random(); // dono (modo GENERATED — não existe ainda)
  const agent = Keypair.random();
  const aegis = deriveAegisSigner(root, companyA); // co-signer derivado da company A
  const dest = Keypair.random(); // "vendor"

  log('Fundando sponsor e dest (friendbot)...');
  await friendbot(sponsor.publicKey());
  await friendbot(dest.publicKey());
  log('  ok\n');

  // --- Setup multisig via helper (modo GENERATED: cria conta do dono) ---
  log('buildWalletSetupTransaction (createOwnerAccount=true, sem trustline USDC)');
  const { transaction, xlmSponsored } = await buildWalletSetupTransaction({
    horizon,
    network,
    sponsorKeypair: sponsor,
    ownerAddress: owner.publicKey(),
    createOwnerAccount: true,
    aegisSignerPubKey: aegis.publicKey(),
    agentSignerPubKeys: [agent.publicKey()],
  });
  log(`  XLM patrocinado pelo sponsor: ${xlmSponsored}`);
  // tx já vem assinada pelo sponsor; o dono adiciona a 2ª assinatura.
  const setupOk = await submit('setup (sponsor + owner)', [owner], transaction.toXDR());
  assert(setupOk, 'setup multisig deveria suceder');

  // --- Verificar estado on-chain ---
  const acc = await horizon.loadAccount(owner.publicKey());
  const signers = acc.signers.map((s) => `${s.key.slice(0, 6)}…=${s.weight}`).join(', ');
  log(`  signers: [${signers}]`);
  log(`  thresholds: low=${acc.thresholds.low_threshold} med=${acc.thresholds.med_threshold} high=${acc.thresholds.high_threshold}`);
  const masterSigner = acc.signers.find((s) => s.key === owner.publicKey());
  assert(acc.signers.length === 3, 'esperava 3 signers (master + agent + aegis)');
  assert(masterSigner?.weight === WALLET_MASTER_WEIGHT, 'master deve ter peso 3');
  assert(acc.thresholds.med_threshold === 2 && acc.thresholds.high_threshold === 3, 'thresholds med=2/high=3');
  assert(
    acc.signers.some((s) => s.key === agent.publicKey() && s.weight === 1),
    'agent signer peso 1 presente',
  );
  assert(
    acc.signers.some((s) => s.key === aegis.publicKey() && s.weight === 1),
    'aegis signer (derivado) peso 1 presente',
  );
  log('  ✅ conta criada, sponsorizada, signers + thresholds corretos\n');

  // --- Dar XLM ao dono para testar pagamento (sponsor envia) ---
  const sAcc = await horizon.loadAccount(sponsor.publicKey());
  const fund = new TransactionBuilder(sAcc, { fee: BASE_FEE, networkPassphrase: network.passphrase })
    .addOperation(Operation.payment({ destination: owner.publicKey(), asset: Asset.native(), amount: '10' }))
    .setTimeout(60)
    .build();
  fund.sign(sponsor);
  await horizon.submitTransaction(fund);

  // helper p/ montar pagamento do dono
  async function buildPayment(): Promise<string> {
    const a = await horizon.loadAccount(owner.publicKey());
    const tx = new TransactionBuilder(a, {
      fee: (Number(BASE_FEE) * 2).toString(),
      networkPassphrase: network.passphrase,
    })
      .addOperation(Operation.payment({ destination: dest.publicKey(), asset: Asset.native(), amount: '1' }))
      .setTimeout(120)
      .build();
    return tx.toXDR();
  }

  log('Re-prova da matriz com as chaves REAIS (derivada + setup helper):');
  const onlyAgent = await submit('só agent', [agent], await buildPayment());
  assert(!onlyAgent, 'agent sozinho não paga');
  const agentAegis = await submit('agent + aegis', [agent, aegis], await buildPayment());
  assert(agentAegis, 'agent + aegis paga');

  // --- Fluxo two-phase real (buildPaymentEnvelope → agente assina → cosign) ---
  log('\nFluxo two-phase (build → agente assina → Aegis valida §6 → co-assina):');
  const memoHash = createHash('sha256').update(randomUUID()).digest();
  // 1. Aegis constrói o envelope (não assina)
  const envelope = await buildPaymentEnvelope({
    horizon,
    network,
    walletAddress: owner.publicKey(),
    destination: dest.publicKey(),
    asset: Asset.native(),
    amount: '1.0000000',
    memoHash,
  });
  // 2. Agente assina client-side
  const agentTx = TransactionBuilder.fromXDR(envelope, network.passphrase);
  agentTx.sign(agent);
  const agentSignedXdr = agentTx.toXDR();
  log('  ✓ envelope construído e assinado pelo agente');

  // 3a. Validação §6 rejeita adulteração (destino trocado)
  const tampered = await buildPaymentEnvelope({
    horizon,
    network,
    walletAddress: owner.publicKey(),
    destination: sponsor.publicKey(), // destino DIFERENTE
    asset: Asset.native(),
    amount: '1.0000000',
    memoHash,
  });
  const tamperedTx = TransactionBuilder.fromXDR(tampered, network.passphrase);
  tamperedTx.sign(agent);
  let rejected = false;
  try {
    validatePaymentEnvelope({
      signedXdr: tamperedTx.toXDR(),
      networkPassphrase: network.passphrase,
      expectedSource: owner.publicKey(),
      expectedDestination: dest.publicKey(),
      expectedAsset: Asset.native(),
      expectedAmount: '1.0000000',
      expectedMemoHash: memoHash,
      expectedAgentSignerPubKey: agent.publicKey(),
    });
  } catch (e) {
    rejected = true;
    log(`  ✓ validação rejeitou envelope adulterado: ${(e as Error).message}`);
  }
  assert(rejected, 'validação deveria rejeitar destino adulterado');

  // 3b. Aegis valida o envelope legítimo, co-assina e submete
  const res = await cosignAndSubmitPayment({
    horizon,
    aegisKeypair: aegis,
    signedXdr: agentSignedXdr,
    networkPassphrase: network.passphrase,
    expectedSource: owner.publicKey(),
    expectedDestination: dest.publicKey(),
    expectedAsset: Asset.native(),
    expectedAmount: '1.0000000',
    expectedMemoHash: memoHash,
    expectedAgentSignerPubKey: agent.publicKey(),
  });
  log(`  ✅ cosign + submit OK → ${res.txHash} (ledger ${res.ledger})`);

  log('\n=== ✅ HELPERS VALIDADOS (setup + two-phase) ===');
  log(`conta: ${EXPERT}/account/${owner.publicKey()}`);
}

main().catch((err) => {
  log('\n❌ erro:', err);
  process.exit(1);
});
