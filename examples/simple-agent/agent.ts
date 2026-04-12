/**
 * Aegis Protocol Simple Agent Demo
 *
 * A standalone TypeScript script that demonstrates the full Aegis Protocol
 * governance flow without requiring an LLM. Useful for quick integration
 * testing and understanding the SDK API.
 *
 * Scenarios covered:
 *   1. Auto-approved spend (<= approval threshold)
 *   2. Requires human approval (above threshold, within max)
 *   3. Rejected by policy (blocked vendor)
 *
 * Setup:
 *   1. Run `pnpm --filter api db:seed` to create demo agents and vendors
 *   2. Copy DEMO_API_KEY and DEMO_COMPANY_ID from seed output to .env
 *   3. Run: pnpm --filter simple-agent start
 *
 * Environment variables:
 *   DEMO_API_KEY    — API key from seed output (cr_xxx)
 *   DEMO_AGENT_ID   — Agent ID from seed output
 *   API_URL         — Aegis Protocol API URL (default: http://localhost:3001)
 */

import { Aegis } from '@aegis/sdk';

const API_KEY = process.env.DEMO_API_KEY;
const AGENT_ID = process.env.DEMO_AGENT_ID;
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

if (!API_KEY || !AGENT_ID) {
  console.error('Missing DEMO_API_KEY or DEMO_AGENT_ID — run db:seed first');
  process.exit(1);
}

const rail = new Aegis({
  apiKey: API_KEY,
  agentId: AGENT_ID,
  baseUrl: API_URL,
});

// ─── Utility ──────────────────────────────────────────────────────────────────

function divider(title: string) {
  console.log('\n' + '─'.repeat(60));
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

function printResult(result: Awaited<ReturnType<typeof rail.requestSpend>>) {
  console.log(`Status:         ${result.status}`);
  console.log(`Policy:         ${result.policyDecision ?? 'n/a'}`);
  console.log(`Reason:         ${result.decisionReason ?? 'n/a'}`);
  if (result.txSignature) {
    console.log(`TX Signature:   ${result.txSignature}`);
    console.log(`Explorer URL:   ${result.explorerUrl}`);
  }
}

// ─── Scenario 1: Auto-approved small spend ────────────────────────────────────
async function scenario1() {
  divider('Scenario 1 — Auto-approved ($5 USDC < $10 threshold)');

  console.log('\nAgent action: purchasing a small data enrichment API call...');

  // requestAndExecute() = submit + auto-execute if approved
  const result = await rail.requestAndExecute({
    actionType: 'purchase_api_access',
    vendor: 'DataVendorX',
    amount: 5,
    reason: 'Enrich 100 leads for Q2 campaign — batch job #445',
  });

  printResult(result);

  if (result.status === 'EXECUTED') {
    console.log('\n✅ Transfer complete! Funds sent to DataVendorX wallet on Solana devnet.');
    console.log('   The agent can now proceed with the API call it purchased.');
  }
}

// ─── Scenario 2: Requires human approval ──────────────────────────────────────
async function scenario2() {
  divider('Scenario 2 — Requires approval ($25 USDC > $10 threshold)');

  console.log('\nAgent action: requesting a larger dataset purchase...');

  const result = await rail.requestSpend({
    actionType: 'purchase_dataset',
    vendor: 'LeadEnricher',
    amount: 25,
    reason: 'Purchase Q2 B2B lead dataset — 50k records for outbound campaign',
    metadata: {
      datasetId: 'dataset-q2-2026',
      recordCount: 50000,
      estimatedROI: '3x',
    },
  });

  printResult(result);

  if (result.status === 'REQUIRES_APPROVAL') {
    console.log('\n⏳ Waiting for human approval...');
    console.log('   → Admin will receive an email notification');
    console.log('   → Open http://localhost:3000/dashboard/approvals to approve');
    console.log(`   → Request ID: ${result.id}`);
    console.log('\n   (In a real agent, call rail.waitForApproval() to poll for the decision)');

    // Demonstrate polling (with short timeout for demo)
    console.log('\nPolling for 30 seconds with 5s interval...');
    try {
      const approved = await rail.waitForApproval(result.id, {
        intervalMs: 5000,
        timeoutMs: 30_000,
      });
      console.log(`\nDecision received: ${approved.status}`);
      if (approved.status === 'APPROVED') {
        const executed = await rail.execute(approved.id);
        console.log(`\n✅ Executed after approval!`);
        printResult(executed);
      }
    } catch {
      console.log('\n⏱️  Polling timed out — no decision in 30s');
      console.log('   In production: use webhooks or longer polling intervals');
    }
  }
}

// ─── Scenario 3: Rejected by policy ──────────────────────────────────────────
async function scenario3() {
  divider('Scenario 3 — Rejected (vendor not in allow list)');

  console.log('\nAgent action: trying to purchase from a non-allowlisted vendor...');

  const result = await rail.requestSpend({
    actionType: 'purchase_api_access',
    vendor: 'ShadyDataBroker',
    amount: 7,
    reason: 'Quick data purchase from new vendor',
  });

  printResult(result);

  if (result.status === 'REJECTED') {
    console.log('\n🚫 Correctly rejected by policy engine.');
    console.log('   The agent cannot spend on vendors outside the allowlist.');
    console.log('   No Solana transaction was created.');
  }
}

// ─── Scenario 4: Budget status ────────────────────────────────────────────────
async function scenario4() {
  divider('Scenario 4 — Budget status check');

  const budget = await rail.getBudgetStatus();
  console.log('\nCurrent budget status:');
  console.log(`  Daily:   $${budget.dailySpent} / $${budget.dailyLimit} ${budget.currency}`);
  console.log(`  Monthly: $${budget.monthlySpent} / $${budget.monthlyLimit} ${budget.currency}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Aegis Protocol Simple Agent Demo');
  console.log('==============================');
  console.log(`API:      ${API_URL}`);
  console.log(`Agent ID: ${AGENT_ID}`);

  try {
    await scenario1();
    await scenario3();
    await scenario4();
    // Run scenario 2 last since it blocks waiting for human input
    await scenario2();
  } catch (err) {
    console.error('\n❌ Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
