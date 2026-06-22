/**
 * PROTÓTIPO (ADR 0007) — modelo não-custodial multisig 5a, na testnet.
 *
 * Self-contained: usa só @stellar/stellar-sdk + friendbot. NÃO importa nada do
 * app nem toca no fluxo custodial. Descartável — valida a mecânica antes de codar.
 *
 * Matriz validada (CORRIGE o furo do rascunho do ADR — ver T5):
 *   master (dono)  weight 3   — offline no dia-a-dia, é a própria conta
 *   agent          weight 1   — hot, assina client-side
 *   aegis          weight 1   — co-signatário obrigatório
 *   thresholds: low=1, medium=2, high=3
 *
 *   pagamento (medium=2): agent(1)+aegis(1)=2  → OK ; cada um sozinho (1) → FALHA
 *   reconfig (high=3):    master(3) sozinho     → OK (recuperação)
 *                         agent+aegis (2)       → FALHA (não conluiam p/ remover o dono)
 *
 * Rodar:
 *   pnpm --filter @aegis/api exec tsx ../../packages/stellar/scripts/proto-multisig.ts
 */

import { createHash } from 'node:crypto';

import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
const PASSPHRASE = Networks.TESTNET;
const EXPERT = 'https://stellar.expert/explorer/testnet';

const server = new Horizon.Server(HORIZON_URL);

function log(...a: unknown[]) {
  console.log(...a);
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

async function friendbot(pub: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(pub)}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (!body.includes('createAccountAlreadyExist') && res.status !== 400) {
      throw new Error(`friendbot ${res.status}: ${body.slice(0, 120)}`);
    }
  }
}

/** "Aegis constrói o envelope canônico" — payment XLM, recarrega sequence fresca. */
async function buildPaymentEnvelope(
  master: string,
  destination: string,
  amount: string,
  memoHash: Buffer,
): Promise<string> {
  const acc = await server.loadAccount(master);
  const tx = new TransactionBuilder(acc, {
    fee: (Number(BASE_FEE) * 2).toString(),
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount }))
    .addMemo(Memo.hash(memoHash))
    .setTimeout(120)
    .build();
  return tx.toXDR();
}

/** Validação §4 do ADR: o Aegis NUNCA assina às cegas. */
function validateEnvelope(
  xdrStr: string,
  expectedSource: string,
  expectedDest: string,
  expectedAmount: string,
  expectedMemo: Buffer,
): void {
  const tx = TransactionBuilder.fromXDR(xdrStr, PASSPHRASE);
  if ('innerTransaction' in tx) throw new Error('fee-bump inesperado');
  if (tx.source !== expectedSource) throw new Error(`source divergente: ${tx.source}`);
  if (tx.operations.length !== 1) throw new Error(`esperava 1 op, veio ${tx.operations.length}`);
  const op = tx.operations[0]!;
  if (op.type !== 'payment') throw new Error(`op inesperada: ${op.type}`);
  if (op.source && op.source !== expectedSource) throw new Error('op.source override suspeito');
  if (op.destination !== expectedDest) throw new Error(`destino divergente: ${op.destination}`);
  if (op.amount !== expectedAmount) throw new Error(`amount divergente: ${op.amount}`);
  if (op.asset.code !== 'XLM' || !op.asset.isNative()) throw new Error('asset inesperado');
  const memo = tx.memo;
  if (memo.type !== 'hash' || !Buffer.from(memo.value as Buffer).equals(expectedMemo)) {
    throw new Error('memo divergente');
  }
}

async function attempt(
  label: string,
  xdrStr: string,
  signers: Keypair[],
): Promise<boolean> {
  const tx = TransactionBuilder.fromXDR(xdrStr, PASSPHRASE);
  for (const s of signers) tx.sign(s);
  try {
    const r = await server.submitTransaction(tx);
    log(`  ✅ ${label} → SUBMETEU  tx=${r.hash}`);
    return true;
  } catch (err) {
    log(`  ⛔ ${label} → REJEITOU  (${codesOf(err)})`);
    return false;
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    log(`\n❌ FALHA DE ASSERÇÃO: ${msg}`);
    process.exit(1);
  }
}

async function main() {
  log('=== PROTÓTIPO multisig não-custodial (ADR 0007) — testnet ===\n');

  const master = Keypair.random(); // dono dos fundos = a própria conta
  const agent = Keypair.random();
  const aegis = Keypair.random();
  const dest = Keypair.random(); // "vendor"

  log('Keypairs:');
  log(`  master/conta : ${master.publicKey()}`);
  log(`  agent        : ${agent.publicKey()}`);
  log(`  aegis        : ${aegis.publicKey()}`);
  log(`  dest(vendor) : ${dest.publicKey()}\n`);

  log('Fundando master e dest via friendbot...');
  await friendbot(master.publicKey());
  await friendbot(dest.publicKey());
  log('  ok\n');

  // --- SETUP: add signers + thresholds (op de high, mas thresholds atuais=0) ---
  log('SETUP: add agent(1) + aegis(1), masterWeight=3, low=1/med=2/high=3');
  {
    const acc = await server.loadAccount(master.publicKey());
    const tx = new TransactionBuilder(acc, {
      fee: (Number(BASE_FEE) * 3).toString(),
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: agent.publicKey(), weight: 1 } }))
      .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: aegis.publicKey(), weight: 1 } }))
      .addOperation(
        Operation.setOptions({ masterWeight: 3, lowThreshold: 1, medThreshold: 2, highThreshold: 3 }),
      )
      .setTimeout(60)
      .build();
    tx.sign(master);
    const r = await server.submitTransaction(tx);
    log(`  ✅ setup submetido  tx=${r.hash}`);
  }

  // verificar estado on-chain
  {
    const acc = await server.loadAccount(master.publicKey());
    const signers = acc.signers
      .map((s) => `${s.key.slice(0, 6)}…=${s.weight}`)
      .join(', ');
    log(`  signers: [${signers}]`);
    log(`  thresholds: low=${acc.thresholds.low_threshold} med=${acc.thresholds.med_threshold} high=${acc.thresholds.high_threshold}`);
    assert(acc.signers.length === 3, 'esperava 3 signers');
    assert(acc.thresholds.med_threshold === 2, 'med threshold deve ser 2');
    assert(acc.thresholds.high_threshold === 3, 'high threshold deve ser 3');
  }

  const amount = '1.5000000';
  const memoHash = createHash('sha256').update('spend-request-proto-001').digest();

  // --- T1: pagamento só com agent → FALHA (1 < 2) ---
  log('\nT1: pagamento assinado SÓ pelo agente (peso 1 < medium 2)');
  {
    const xdr = await buildPaymentEnvelope(master.publicKey(), dest.publicKey(), amount, memoHash);
    const ok = await attempt('só agent', xdr, [agent]);
    assert(!ok, 'T1 deveria falhar: agente sozinho não pode pagar');
  }

  // --- T2: pagamento só com aegis → FALHA ---
  log('\nT2: pagamento assinado SÓ pelo Aegis (peso 1 < medium 2)');
  {
    const xdr = await buildPaymentEnvelope(master.publicKey(), dest.publicKey(), amount, memoHash);
    const ok = await attempt('só aegis', xdr, [aegis]);
    assert(!ok, 'T2 deveria falhar: Aegis sozinho não pode pagar');
  }

  // --- T3: fluxo 5a — agente assina, Aegis valida e co-assina → OK ---
  log('\nT3: fluxo 5a — Aegis monta envelope → agente assina → Aegis valida+co-assina');
  {
    const issued = await buildPaymentEnvelope(master.publicKey(), dest.publicKey(), amount, memoHash);

    // agente assina client-side
    const agentTx = TransactionBuilder.fromXDR(issued, PASSPHRASE);
    agentTx.sign(agent);
    const agentSigned = agentTx.toXDR();

    // Aegis valida o envelope ANTES de co-assinar (§4)
    validateEnvelope(agentSigned, master.publicKey(), dest.publicKey(), amount, memoHash);
    log('  ✅ envelope validado (1 payment, destino/amount/memo conferem)');

    const ok = await attempt('agent + aegis', agentSigned, [aegis]);
    assert(ok, 'T3 deveria suceder: agent + aegis = 2 ≥ medium 2');
  }

  // --- T5: op de high (reconfig) por agent+aegis → FALHA (2 < 3) ---
  log('\nT5: agent+aegis tentam reconfigurar a conta (high=3) — deve FALHAR');
  {
    const acc = await server.loadAccount(master.publicKey());
    const tx = new TransactionBuilder(acc, {
      fee: BASE_FEE,
      networkPassphrase: PASSPHRASE,
    })
      // tentativa de golpe: rebaixar thresholds p/ agent+aegis controlarem sozinhos
      .addOperation(Operation.setOptions({ medThreshold: 1, highThreshold: 1 }))
      .setTimeout(60)
      .build();
    const ok = await attempt('agent + aegis (high)', tx.toXDR(), [agent, aegis]);
    assert(!ok, 'T5 deveria falhar: agent+aegis (2) < high (3) → não conluiam contra o dono');
  }

  // --- T4: recuperação — master sozinha reconfigura (3 ≥ high 3) → OK ---
  log('\nT4: recuperação — dono (master, peso 3) reconfigura sozinho (≥ high 3)');
  {
    const acc = await server.loadAccount(master.publicKey());
    const tx = new TransactionBuilder(acc, {
      fee: (Number(BASE_FEE) * 2).toString(),
      networkPassphrase: PASSPHRASE,
    })
      // remove o Aegis e volta a conta ao controle exclusivo do dono
      .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: aegis.publicKey(), weight: 0 } }))
      .addOperation(
        Operation.setOptions({ masterWeight: 1, lowThreshold: 1, medThreshold: 1, highThreshold: 1 }),
      )
      .setTimeout(60)
      .build();
    const ok = await attempt('só master', tx.toXDR(), [master]);
    assert(ok, 'T4 deveria suceder: master (3) ≥ high (3)');
  }

  log('\n=== ✅ TODOS OS CENÁRIOS PASSARAM ===');
  log(`conta no explorer: ${EXPERT}/account/${master.publicKey()}`);
}

main().catch((err) => {
  log('\n❌ erro não tratado:', err);
  process.exit(1);
});
