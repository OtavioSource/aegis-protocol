/**
 * CommandRail AI Agent Demo — Marketing Campaign Procurement Agent
 *
 * A real AI agent (Claude claude-sonnet-4-6) that autonomously plans and executes
 * procurement for a marketing campaign, with every spend decision governed
 * by CommandRail policy engine and settled on Solana devnet.
 *
 * Scenarios demonstrated:
 *   1. Budget check — agent knows its limits before spending
 *   2. Small spend $7 (DataVendorX) → auto-approved → Solana transfer
 *   3. Large spend $25 (LeadEnricher) → requires human approval → approve in dashboard → transfer
 *   4. Blocked vendor (ShadyDataBroker) → rejected by policy
 *   5. Final budget check — shows accumulated spend
 *
 * Usage:
 *   pnpm start         — uses ANTHROPIC_API_KEY for real Claude
 *   pnpm start:mock    — pre-scripted responses, no API key needed
 *
 * Setup:
 *   1. cp .env.example .env && fill in DEMO_API_KEY, DEMO_AGENT_ID
 *   2. pnpm --filter api db:seed
 *   3. POST /companies/:id/treasuries/:id/fund-demo
 *   4. pnpm start:mock
 */

import Anthropic from '@anthropic-ai/sdk';
import { CommandRail } from '@command-rail/sdk';
import type {
  MessageParam,
  ToolUseBlock,
  TextBlock,
} from '@anthropic-ai/sdk/resources/messages.js';
import { toolDefinitions, handleToolCall } from './tools.js';
import { createMockClient } from './mock-claude.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const API_KEY = process.env.DEMO_API_KEY;
const AGENT_ID = process.env.DEMO_AGENT_ID;
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:3000';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const useMock = process.argv.includes('--mock') || !ANTHROPIC_API_KEY;

if (!API_KEY || !AGENT_ID) {
  console.error('❌ Missing DEMO_API_KEY or DEMO_AGENT_ID');
  console.error('   Run: pnpm --filter api db:seed');
  process.exit(1);
}

// ─── ANSI Colors ──────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  violet: '\x1b[35m',
};

// ─── Init ─────────────────────────────────────────────────────────────────────

const rail = new CommandRail({
  apiKey: API_KEY,
  agentId: AGENT_ID,
  baseUrl: API_URL,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const claude: any = useMock ? createMockClient() : new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a procurement AI agent for Acme Corp's marketing team.
Your task is to plan and execute purchasing for the Q2 marketing campaign.

You have access to the following tools:
- check_budget: Check your remaining budget before making purchases
- purchase_service: Buy services/data from approved vendors
- wait_for_approval: Wait for human approval on larger purchases

Available vendors and their services:
- DataVendorX: Lead data enrichment API ($5-15 per batch)
- LeadEnricher: B2B lead datasets ($20-50 per dataset)
- EmailAPI: Transactional email delivery ($3-10 per campaign)

Policy rules (enforced automatically):
- Purchases under $10 USDC are auto-approved
- Purchases above $10 USDC require human approval
- Maximum per transaction: $50 USDC
- Only the vendors listed above are allowed

Work through the campaign systematically:
1. Check your budget first
2. Purchase lead enrichment from DataVendorX
3. Purchase a lead dataset from LeadEnricher (will require approval)
4. Wait for approval on the LeadEnricher purchase
5. Optionally try an alternative vendor to demonstrate policy enforcement
6. Do a final budget check
7. Provide a concise summary of what was accomplished

Be direct and action-oriented. Don't overthink — just use the tools in order.`;

const USER_PROMPT =
  'Please plan and execute procurement for our Q2 marketing campaign. We need lead enrichment data and a B2B lead dataset. Our goal is to get the best data coverage within budget while following company policy.';

// ─── Agent Loop ───────────────────────────────────────────────────────────────

async function run() {
  console.log('\n' + '═'.repeat(62));
  console.log(`${c.bold}${c.violet}  CommandRail — Marketing Campaign Procurement Agent${c.reset}`);
  console.log('═'.repeat(62));
  console.log(`  Mode:     ${useMock ? `${c.yellow}MOCK (pre-scripted)${c.reset}` : `${c.cyan}LIVE (Claude claude-sonnet-4-6)${c.reset}`}`);
  console.log(`  Agent ID: ${c.dim}${AGENT_ID}${c.reset}`);
  console.log(`  API:      ${c.dim}${API_URL}${c.reset}`);
  console.log(`  Dashboard:${c.dim} ${DASHBOARD_URL}${c.reset}`);
  console.log('═'.repeat(62) + '\n');

  const messages: MessageParam[] = [{ role: 'user', content: USER_PROMPT }];

  let iteration = 0;
  const MAX_ITERATIONS = 12;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: toolDefinitions,
      messages,
    });

    // Print agent text
    for (const block of response.content) {
      if ((block as TextBlock).type === 'text' && (block as TextBlock).text) {
        console.log(`\n${c.violet}🤖 Agent:${c.reset} ${(block as TextBlock).text}`);
      }
    }

    // If no tool calls, we're done
    if (response.stop_reason === 'end_turn') {
      console.log('\n' + '═'.repeat(62));
      console.log(`${c.bold}  ✅ Agent finished.${c.reset}`);
      console.log('═'.repeat(62) + '\n');
      break;
    }

    // Add assistant message to history
    messages.push({ role: 'assistant', content: response.content });

    // Process tool calls
    const toolResults: MessageParam['content'] = [];

    for (const block of response.content) {
      const toolBlock = block as ToolUseBlock;
      if (toolBlock.type !== 'tool_use') continue;

      console.log('');
      const result = await handleToolCall(
        toolBlock.name,
        toolBlock.input as Record<string, unknown>,
        rail,
        DASHBOARD_URL,
      );

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: result,
      });
    }

    if (toolResults.length > 0) {
      messages.push({ role: 'user', content: toolResults });
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    console.log(`\n${c.yellow}⚠️  Max iterations (${MAX_ITERATIONS}) reached.${c.reset}`);
  }
}

run().catch((err) => {
  console.error('\n❌ Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
