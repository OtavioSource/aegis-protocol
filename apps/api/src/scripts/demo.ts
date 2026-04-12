/**
 * Aegis Protocol — Demo Script
 *
 * Simulates an AI agent (Marketing Bot) making economic decisions
 * governed by Aegis Protocol's policy engine + Solana treasury.
 *
 * Usage:
 *   pnpm --filter @aegis/api tsx src/scripts/demo.ts
 *
 * Make sure the API server is NOT running (this script uses Prisma directly).
 * Or point BASE_URL to a running instance.
 */

const BASE_URL = process.env['API_URL'] ?? 'http://localhost:3001';
const API_KEY = process.env['DEMO_API_KEY'] ?? '';
const COMPANY_ID = process.env['DEMO_COMPANY_ID'] ?? '';

// ── ANSI colors ──────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

function log(msg: string) { process.stdout.write(msg + '\n'); }
function dim(msg: string) { log(`${c.dim}${msg}${c.reset}`); }
function header(msg: string) { log(`\n${c.bold}${c.cyan}${msg}${c.reset}`); }
function step(n: number, msg: string) { log(`\n${c.bold}${c.white}[${n}]${c.reset} ${msg}`); }
function ok(msg: string) { log(`    ${c.green}✓${c.reset} ${msg}`); }
function fail(msg: string) { log(`    ${c.red}✗${c.reset} ${msg}`); }
function warn(msg: string) { log(`    ${c.yellow}⚠${c.reset} ${msg}`); }
function info(msg: string) { log(`    ${c.dim}→${c.reset} ${msg}`); }
function divider() { log(`\n${c.dim}${'─'.repeat(60)}${c.reset}`); }

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiPost(path: string, body: unknown, authKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authKey) headers['Authorization'] = `Bearer ${authKey}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function apiGet(path: string) {
  const res = await fetch(`${BASE_URL}${path}`);
  return res.json() as Promise<unknown>;
}

function statusBadge(status: string): string {
  switch (status) {
    case 'APPROVED': return `${c.bgGreen}${c.bold} APPROVED ${c.reset}`;
    case 'EXECUTED': return `${c.bgGreen}${c.bold} EXECUTED ${c.reset}`;
    case 'REQUIRES_APPROVAL': return `${c.bold}${c.yellow} REQUIRES APPROVAL ${c.reset}`;
    case 'REJECTED': return `${c.bgRed}${c.bold} REJECTED ${c.reset}`;
    default: return `${c.dim} ${status} ${c.reset}`;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log('');
  log(`${c.bold}${c.magenta}╔═══════════════════════════════════════════════╗${c.reset}`);
  log(`${c.bold}${c.magenta}║        Aegis Protocol — Live Demo                ║${c.reset}`);
  log(`${c.bold}${c.magenta}║  Economic Governance for AI Agents on Solana  ║${c.reset}`);
  log(`${c.bold}${c.magenta}╚═══════════════════════════════════════════════╝${c.reset}`);
  log('');
  dim('  Scenario: Marketing Bot (AI agent) attempts 4 purchases.');
  dim('  Policy engine evaluates each one. Treasury executes on Solana.');
  await wait(1500);

  // ── Validate config ──────────────────────────────────────────────────────
  if (!API_KEY || !COMPANY_ID) {
    log('');
    log(`${c.red}Missing DEMO_API_KEY or DEMO_COMPANY_ID env vars.${c.reset}`);
    log('Run the seed first: pnpm --filter @aegis/api db:seed');
    process.exit(1);
  }

  // ── Check API health ─────────────────────────────────────────────────────
  header('Connecting to Aegis Protocol API...');
  try {
    const health = await apiGet('/health') as { status: string };
    ok(`API is live — ${BASE_URL}`);
    dim(`     status: ${health.status}`);
  } catch {
    fail(`Cannot reach API at ${BASE_URL}`);
    process.exit(1);
  }
  await wait(800);

  divider();
  header('SCENARIO 1 — Small spend (auto-approved + Solana transfer)');
  log(`${c.dim}  Marketing Bot requests 7 USDC to buy API access from DataVendorX.${c.reset}`);
  log(`${c.dim}  Policy: requireApprovalAbove=10, vendor in allowList ✓${c.reset}`);
  await wait(1000);

  step(1, 'Agent submits spend request...');
  const req1 = await apiPost('/spend-requests', {
    actionType: 'purchase_api_access',
    vendor: 'DataVendorX',
    amount: 7,
    currency: 'USDC',
    reason: 'Monthly API subscription for lead scoring model',
  }, API_KEY);

  info(`vendor: ${req1['vendor']} | amount: ${req1['amount']} USDC`);
  info(`policy decision: ${statusBadge(req1['policyDecision'] as string)}`);
  info(`reason: ${req1['decisionReason']}`);

  if (req1['status'] === 'APPROVED') {
    ok('Policy engine auto-approved the request');
    await wait(600);

    step(2, 'Executing SPL token transfer on Solana...');
    const exec1 = await apiPost(`/spend-requests/${req1['id']}/execute`, {}, API_KEY) as Record<string, unknown>;

    if (exec1['status'] === 'EXECUTED') {
      ok(`Transfer executed on-chain!`);
      info(`tx: ${c.cyan}${(exec1['txSignature'] as string)?.slice(0, 32)}...${c.reset}`);
      if (exec1['explorerUrl']) info(`explorer: ${exec1['explorerUrl']}`);
    } else {
      warn(`Execution failed: ${exec1['message'] ?? exec1['status']}`);
    }
  }

  await wait(1200);
  divider();
  header('SCENARIO 2 — Medium spend (requires human approval)');
  log(`${c.dim}  Marketing Bot requests 30 USDC for a lead dataset.${c.reset}`);
  log(`${c.dim}  Policy: requireApprovalAbove=10 → exceeds threshold${c.reset}`);
  await wait(1000);

  step(1, 'Agent submits spend request...');
  const req2 = await apiPost('/spend-requests', {
    actionType: 'purchase_dataset',
    vendor: 'LeadEnricher',
    amount: 30,
    currency: 'USDC',
    reason: 'Q2 B2B leads dataset — 50k verified contacts',
  }, API_KEY);

  info(`vendor: ${req2['vendor']} | amount: ${req2['amount']} USDC`);
  info(`policy decision: ${statusBadge(req2['policyDecision'] as string)}`);
  info(`reason: ${req2['decisionReason']}`);

  if (req2['status'] === 'REQUIRES_APPROVAL') {
    ok('Request queued for human review');
    await wait(600);

    step(2, 'Admin reviews and approves via dashboard...');
    await wait(800);

    // Get the approval request
    const approvals = await apiGet(`/approvals/pending?companyId=${COMPANY_ID}`) as Array<{ id: string }>;
    const approval = approvals[0]; // take first pending

    if (approval) {
      const approved = await apiPost(`/approvals/${approval.id}/approve`, {
        decisionReason: 'Verified with Growth team — approved for Q2 campaign',
      }) as Record<string, unknown>;

      ok(`Admin approved! Decision: ${approved['status']}`);
      await wait(600);

      step(3, 'Executing approved transfer on Solana...');
      const exec2 = await apiPost(`/spend-requests/${req2['id']}/execute`, {}, API_KEY) as Record<string, unknown>;

      if (exec2['status'] === 'EXECUTED') {
        ok('Transfer executed on-chain!');
        info(`tx: ${c.cyan}${(exec2['txSignature'] as string)?.slice(0, 32)}...${c.reset}`);
        if (exec2['explorerUrl']) info(`explorer: ${exec2['explorerUrl']}`);
      } else {
        warn(`Execution: ${exec2['message'] ?? exec2['status']}`);
      }
    } else {
      warn('No pending approval found');
    }
  }

  await wait(1200);
  divider();
  header('SCENARIO 3 — Blocked vendor (rejected by policy)');
  log(`${c.dim}  Marketing Bot tries to buy from a vendor NOT on the allowList.${c.reset}`);
  log(`${c.dim}  Policy: vendorAllowList=[DataVendorX, LeadEnricher, EmailAPI]${c.reset}`);
  await wait(1000);

  step(1, 'Agent submits spend request...');
  const req3 = await apiPost('/spend-requests', {
    actionType: 'purchase_api_access',
    vendor: 'shady-data-broker.io',
    amount: 5,
    currency: 'USDC',
    reason: 'Cheap leads from unknown source',
  }, API_KEY);

  info(`vendor: ${req3['vendor']} | amount: ${req3['amount']} USDC`);
  info(`policy decision: ${statusBadge(req3['policyDecision'] as string)}`);
  info(`matched rule: ${c.red}${req3['matchedRule']}${c.reset}`);
  info(`reason: ${req3['decisionReason']}`);

  if (req3['status'] === 'REJECTED') {
    ok('Request blocked — vendor not on allowList');
    ok('No funds moved. Audit log updated.');
  }

  await wait(1200);
  divider();
  header('SCENARIO 4 — Kill switch (emergency stop)');
  log(`${c.dim}  Admin activates kill switch on the Marketing Bot.${c.reset}`);
  log(`${c.dim}  All subsequent requests from this agent are immediately blocked.${c.reset}`);
  await wait(1000);

  // Get agent ID from API key
  const agentsRaw = await apiGet(`/companies/${COMPANY_ID}/agents`) as Array<{ id: string; name: string }>;
  const agent = agentsRaw.find((a) => a.name === 'Marketing Bot');

  if (!agent) {
    warn('Marketing Bot not found');
  } else {
    step(1, `Activating kill switch on ${c.bold}${agent.name}${c.reset}...`);
    await apiPost(`/agents/${agent.id}/kill-switch`, { active: true });
    ok(`Kill switch ACTIVATED — agent ID: ${agent.id.slice(0, 12)}...`);
    await wait(600);

    step(2, 'Agent tries to make a purchase...');
    const req4 = await apiPost('/spend-requests', {
      actionType: 'purchase_api_access',
      vendor: 'DataVendorX',
      amount: 5,
      currency: 'USDC',
      reason: 'Trying to spend after kill switch',
    }, API_KEY);

    info(`policy decision: ${statusBadge(req4['policyDecision'] as string)}`);
    info(`matched rule: ${c.red}${req4['matchedRule']}${c.reset}`);
    info(`reason: ${req4['decisionReason']}`);

    if (req4['status'] === 'REJECTED') {
      ok(`${c.bold}${c.red}BLOCKED${c.reset} — kill switch is active. Zero funds moved.`);
    }

    await wait(600);
    step(3, 'Admin deactivates kill switch...');
    await apiPost(`/agents/${agent.id}/kill-switch`, { active: false });
    ok('Kill switch deactivated — agent restored');
  }

  await wait(800);
  divider();

  // ── Summary ──────────────────────────────────────────────────────────────
  log('');
  log(`${c.bold}${c.magenta}╔═══════════════════════════════════════════════╗${c.reset}`);
  log(`${c.bold}${c.magenta}║              Demo Complete                    ║${c.reset}`);
  log(`${c.bold}${c.magenta}╚═══════════════════════════════════════════════╝${c.reset}`);
  log('');
  log(`  ${c.green}✓${c.reset} Scenario 1: ${c.bold}7 USDC${c.reset} auto-approved → Solana transfer executed`);
  log(`  ${c.green}✓${c.reset} Scenario 2: ${c.bold}30 USDC${c.reset} held for approval → approved → Solana transfer`);
  log(`  ${c.green}✓${c.reset} Scenario 3: Blocked vendor → ${c.bold}rejected by policy${c.reset}, no funds moved`);
  log(`  ${c.green}✓${c.reset} Scenario 4: ${c.bold}Kill switch${c.reset} → all requests blocked instantly`);
  log('');
  log(`  ${c.dim}Dashboard: http://localhost:3000${c.reset}`);
  log(`  ${c.dim}Audit log: http://localhost:3000/dashboard/audit${c.reset}`);
  log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
