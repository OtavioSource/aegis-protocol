/**
 * CommandRail Tool Definitions for Claude tool_use
 *
 * Defines the 3 tools the AI agent can call:
 *   - check_budget     → rail.getBudgetStatus()
 *   - purchase_service → rail.requestAndExecute()
 *   - wait_for_approval → rail.waitForApproval() + rail.execute()
 */

import type { CommandRail } from '@command-rail/sdk';
import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';

// ─── Tool Definitions (Claude format) ────────────────────────────────────────

export const toolDefinitions: Tool[] = [
  {
    name: 'check_budget',
    description:
      'Check the current budget status for this agent. Returns daily and monthly spend limits and how much has been spent so far. Call this before making purchases to understand available budget.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'purchase_service',
    description:
      'Purchase a service or data from a vendor. The request is evaluated by the CommandRail policy engine — it may be auto-approved, require human approval, or be rejected. Auto-approved requests are executed immediately on Solana. Returns the request status, decision reason, and transaction details if executed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        vendor: {
          type: 'string',
          description:
            'Name of the vendor to purchase from (e.g. "DataVendorX", "LeadEnricher", "EmailAPI")',
        },
        amount: {
          type: 'number',
          description: 'Amount in USDC to pay the vendor',
        },
        action_type: {
          type: 'string',
          description:
            'Type of action being performed (e.g. "purchase_api_access", "purchase_dataset", "enrich_leads")',
        },
        reason: {
          type: 'string',
          description: 'Business justification for this purchase (1-2 sentences)',
        },
      },
      required: ['vendor', 'amount', 'action_type', 'reason'],
    },
  },
  {
    name: 'wait_for_approval',
    description:
      'Wait for a human to approve or reject a spend request that requires approval. Polls every 5 seconds for up to 2 minutes. Returns the final decision and transaction details if approved and executed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        request_id: {
          type: 'string',
          description: 'The spend request ID returned by purchase_service',
        },
      },
      required: ['request_id'],
    },
  },
];

// ─── Tool Input Types ─────────────────────────────────────────────────────────

type PurchaseServiceInput = {
  vendor: string;
  amount: number;
  action_type: string;
  reason: string;
};

type WaitForApprovalInput = {
  request_id: string;
};

// ─── ANSI Colors ──────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function box(lines: string[], color: string) {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const hr = '─'.repeat(width - 2);
  console.log(`  ${color}┌${hr}┐${c.reset}`);
  for (const line of lines) {
    const pad = ' '.repeat(width - 4 - line.length);
    console.log(`  ${color}│${c.reset}  ${line}${pad}  ${color}│${c.reset}`);
  }
  console.log(`  ${color}└${hr}┘${c.reset}`);
}

// ─── Tool Handler ─────────────────────────────────────────────────────────────

export async function handleToolCall(
  name: string,
  input: Record<string, unknown>,
  rail: CommandRail,
  dashboardUrl: string,
): Promise<string> {
  try {
    if (name === 'check_budget') {
      console.log(`  ${c.dim}→ Tool: check_budget${c.reset}`);
      const budget = await rail.getBudgetStatus();
      const result = `Daily: $${budget.dailySpent} / $${budget.dailyLimit} | Monthly: $${budget.monthlySpent} / $${budget.monthlyLimit} ${budget.currency}`;
      console.log(`  ${c.green}✅ ${result}${c.reset}`);
      return JSON.stringify(budget);
    }

    if (name === 'purchase_service') {
      const inp = input as PurchaseServiceInput;
      console.log(
        `  ${c.dim}→ Tool: purchase_service → ${inp.vendor}, $${inp.amount} USDC${c.reset}`,
      );

      const result = await rail.requestAndExecute({
        actionType: inp.action_type,
        vendor: inp.vendor,
        amount: inp.amount,
        reason: inp.reason,
      });

      if (result.status === 'EXECUTED') {
        const txShort = result.txSignature
          ? `${result.txSignature.slice(0, 8)}...${result.txSignature.slice(-4)}`
          : 'n/a';
        box(
          [
            `✅ APPROVED — Auto-approved`,
            `TX: ${txShort}`,
            ...(result.explorerUrl ? [result.explorerUrl] : []),
          ],
          c.green,
        );
        return JSON.stringify({
          status: result.status,
          txSignature: result.txSignature,
          explorerUrl: result.explorerUrl,
          message: `Purchase approved and executed on Solana. TX: ${result.txSignature}`,
        });
      }

      if (result.status === 'REQUIRES_APPROVAL') {
        box(
          [
            `⏳ REQUIRES APPROVAL — Above threshold`,
            `Request ID: ${result.id}`,
            `Approve at: ${dashboardUrl}/dashboard/approvals`,
          ],
          c.yellow,
        );
        return JSON.stringify({
          status: result.status,
          requestId: result.id,
          message: `Purchase requires human approval. Request ID: ${result.id}. Use wait_for_approval to poll for the decision.`,
        });
      }

      // REJECTED
      box([`🚫 REJECTED — ${result.decisionReason ?? 'Policy violation'}`], c.red);
      return JSON.stringify({
        status: result.status,
        reason: result.decisionReason,
        message: `Purchase rejected by policy: ${result.decisionReason}`,
      });
    }

    if (name === 'wait_for_approval') {
      const inp = input as WaitForApprovalInput;
      console.log(`  ${c.dim}→ Tool: wait_for_approval → ${inp.request_id}${c.reset}`);
      console.log(
        `  ${c.yellow}⏳ Polling for approval... (approve at ${dashboardUrl}/dashboard/approvals)${c.reset}`,
      );

      const result = await rail.waitForApproval(inp.request_id, {
        intervalMs: 5000,
        timeoutMs: 120_000,
      });

      if (result.status === 'APPROVED') {
        console.log(`  ${c.green}✅ Approved! Executing on Solana...${c.reset}`);
        const executed = await rail.execute(result.id);
        if (executed.txSignature) {
          console.log(`  ${c.green}TX: ${executed.txSignature}${c.reset}`);
          if (executed.explorerUrl) {
            console.log(`  ${c.dim}${executed.explorerUrl}${c.reset}`);
          }
        }
        return JSON.stringify({
          status: 'EXECUTED',
          txSignature: executed.txSignature,
          explorerUrl: executed.explorerUrl,
          message: `Approved and executed on Solana! TX: ${executed.txSignature}`,
        });
      }

      if (result.status === 'REJECTED') {
        box([`🚫 Rejected by approver — ${result.decisionReason ?? 'No reason given'}`], c.red);
        return JSON.stringify({
          status: 'REJECTED',
          reason: result.decisionReason,
          message: `Request was rejected by the approver: ${result.decisionReason}`,
        });
      }

      return JSON.stringify({ status: result.status, message: `Unexpected status: ${result.status}` });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ${c.red}❌ Tool error: ${message}${c.reset}`);
    // Never crash — return error as string so Claude can adapt
    return JSON.stringify({ error: message });
  }
}
