/**
 * @file setup-demo.ts
 * @package @aegis/stellar
 *
 * ═══════════════════════════════════════════════════════════════
 *  STELLAR DEMO SETUP — END-TO-END TESTNET PROVISIONING
 * ═══════════════════════════════════════════════════════════════
 *
 * Provisions all the accounts and liquidity needed for the cross-currency
 * path payment demo. Run once per testnet reset.
 *
 *   $ pnpm --filter @aegis/stellar tsx src/scripts/setup-demo.ts
 *
 * What it does (in order):
 *
 *   1. Create USDC issuer + EURC issuer accounts. Fund both via Friendbot.
 *
 *   2. Create a "market maker" account. Fund via Friendbot. Establish
 *      trustlines to both USDC and EURC. The issuers send the market
 *      maker a starting inventory of USDC and EURC.
 *
 *   3. The market maker places sell offers on the on-ledger DEX:
 *        - SELL 5,000 USDC for EURC at rate 0.91 (approx EUR/USD)
 *        - SELL 5,000 EURC for USDC at rate 1.10
 *      This creates depth on the USDC<->EURC orderbook so path payments
 *      can find liquidity in both directions.
 *
 *   4. Create a treasury account. Fund via Friendbot. Establish trustline
 *      to USDC. The USDC issuer sends 1,000 USDC starting balance.
 *
 *   5. Create a vendor account ("OpenAI EU"). Fund via Friendbot. Establish
 *      trustline to EURC.
 *
 *   6. Print all addresses + secrets so the operator can paste them into
 *      apps/api/.env (STELLAR_DEMO_USDC_ISSUER, STELLAR_DEMO_EURC_ISSUER,
 *      and the treasury/vendor seed secrets if running the API directly).
 *
 * Idempotency: this script is NOT idempotent — every run creates fresh
 * accounts. Friendbot rejects re-funding so re-running with hardcoded keys
 * would fail. For a deterministic demo, save the output of the first run.
 */

import {
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  Asset,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { fundTestnetAccount } from '../friendbot.js';
import { networkPassphrase, horizonUrl } from '../constants.js';

const NETWORK = 'stellar-testnet' as const;
const server = new Horizon.Server(horizonUrl(NETWORK));

type Account = { kp: Keypair; label: string };

function logHeader(s: string) {
  console.log('\n' + '═'.repeat(70));
  console.log('  ' + s);
  console.log('═'.repeat(70));
}

function logAccount(label: string, kp: Keypair) {
  console.log(`\n  ${label}`);
  console.log(`    Public:  ${kp.publicKey()}`);
  console.log(`    Secret:  ${kp.secret()}`);
}

async function fundAccount(label: string): Promise<Account> {
  const kp = Keypair.random();
  console.log(`  · Funding ${label} via Friendbot...`);
  await fundTestnetAccount(kp.publicKey());
  console.log(`    ✓ Funded`);
  return { kp, label };
}

async function submitTx(sourceKp: Keypair, ops: ReturnType<typeof Operation.payment>[]) {
  const account = await server.loadAccount(sourceKp.publicKey());
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(NETWORK),
  });
  for (const op of ops) builder.addOperation(op);
  const tx = builder.setTimeout(60).build();
  tx.sign(sourceKp);
  return server.submitTransaction(tx);
}

async function main() {
  logHeader('Aegis Protocol — Stellar Cross-Currency Demo Setup');
  console.log('Network: Stellar testnet (https://horizon-testnet.stellar.org)\n');

  // ───────────────────────────────────────────────────────────────────
  // 1. Issuer accounts for USDC and EURC
  // ───────────────────────────────────────────────────────────────────
  logHeader('Step 1: Create + fund asset issuers');
  const usdcIssuer = await fundAccount('USDC issuer');
  const eurcIssuer = await fundAccount('EURC issuer');

  const USDC = new Asset('USDC', usdcIssuer.kp.publicKey());
  const EURC = new Asset('EURC', eurcIssuer.kp.publicKey());

  // ───────────────────────────────────────────────────────────────────
  // 2. Market maker account with USDC + EURC liquidity
  // ───────────────────────────────────────────────────────────────────
  logHeader('Step 2: Create market maker + seed inventory');
  const marketMaker = await fundAccount('Market maker');

  console.log('  · Establishing trustlines (USDC + EURC)...');
  await submitTx(marketMaker.kp, [
    Operation.changeTrust({ asset: USDC }),
    Operation.changeTrust({ asset: EURC }),
  ]);
  console.log('    ✓ Trustlines established');

  console.log('  · Issuer minting 10,000 USDC to market maker...');
  await submitTx(usdcIssuer.kp, [
    Operation.payment({
      destination: marketMaker.kp.publicKey(),
      asset: USDC,
      amount: '10000',
    }),
  ]);
  console.log('    ✓ Minted');

  console.log('  · Issuer minting 10,000 EURC to market maker...');
  await submitTx(eurcIssuer.kp, [
    Operation.payment({
      destination: marketMaker.kp.publicKey(),
      asset: EURC,
      amount: '10000',
    }),
  ]);
  console.log('    ✓ Minted');

  // ───────────────────────────────────────────────────────────────────
  // 3. Market maker places offers on USDC<->EURC DEX
  // ───────────────────────────────────────────────────────────────────
  logHeader('Step 3: Place USDC<->EURC sell offers');
  console.log('  · Sell 5,000 USDC for EURC at rate 0.91 EURC/USDC...');
  console.log('  · Sell 5,000 EURC for USDC at rate 1.10 USDC/EURC...');
  await submitTx(marketMaker.kp, [
    // Sell USDC, want EURC. Price = how much EURC you want per 1 USDC sold.
    Operation.manageSellOffer({
      selling: USDC,
      buying: EURC,
      amount: '5000',
      price: '0.91',
    }),
    // Sell EURC, want USDC. Price = how much USDC you want per 1 EURC sold.
    Operation.manageSellOffer({
      selling: EURC,
      buying: USDC,
      amount: '5000',
      price: '1.10',
    }),
  ]);
  console.log('    ✓ Offers placed — orderbook has depth in both directions');

  // ───────────────────────────────────────────────────────────────────
  // 4. Treasury account (the AI agent's settlement wallet)
  // ───────────────────────────────────────────────────────────────────
  logHeader('Step 4: Create treasury (Aegis-managed agent wallet)');
  const treasury = await fundAccount('Treasury');

  console.log('  · Treasury establishing trustline to USDC...');
  await submitTx(treasury.kp, [Operation.changeTrust({ asset: USDC })]);
  console.log('    ✓ Trustline established');

  console.log('  · USDC issuer sending 1,000 USDC starting balance to treasury...');
  await submitTx(usdcIssuer.kp, [
    Operation.payment({
      destination: treasury.kp.publicKey(),
      asset: USDC,
      amount: '1000',
    }),
  ]);
  console.log('    ✓ Treasury funded with 1,000 USDC');

  // ───────────────────────────────────────────────────────────────────
  // 5. Vendor account ("OpenAI EU")
  // ───────────────────────────────────────────────────────────────────
  logHeader('Step 5: Create vendor account ("OpenAI EU")');
  const vendor = await fundAccount('Vendor (OpenAI EU)');

  console.log('  · Vendor establishing trustline to EURC...');
  await submitTx(vendor.kp, [Operation.changeTrust({ asset: EURC })]);
  console.log('    ✓ Trustline established. Vendor ready to receive EURC.');

  // ───────────────────────────────────────────────────────────────────
  // 6. Summary — paste these into .env
  // ───────────────────────────────────────────────────────────────────
  logHeader('Setup complete — copy these into apps/api/.env');

  console.log('\n# Stellar testnet configuration');
  console.log(`STELLAR_DEMO_USDC_ISSUER=${usdcIssuer.kp.publicKey()}`);
  console.log(`STELLAR_DEMO_EURC_ISSUER=${eurcIssuer.kp.publicKey()}`);

  logHeader('Account references (save for the demo run)');
  logAccount('USDC Issuer', usdcIssuer.kp);
  logAccount('EURC Issuer', eurcIssuer.kp);
  logAccount('Market Maker', marketMaker.kp);
  logAccount('Treasury (Aegis-managed)', treasury.kp);
  logAccount('Vendor (OpenAI EU)', vendor.kp);

  console.log('\n📝 Next steps:');
  console.log('   1. Add STELLAR_DEMO_*_ISSUER lines above to apps/api/.env');
  console.log('   2. Use the Treasury secret to seed a Stellar treasury in Aegis');
  console.log('   3. Register vendor with VendorWallet network=stellar-testnet');
  console.log('   4. Submit a SpendRequest with currency=USDC, receiveAsset=EURC');
  console.log('   5. Watch the path payment fire and check stellar.expert for the tx\n');
}

main().catch((err) => {
  console.error('\n❌ Setup failed:', err);
  process.exit(1);
});
