/**
 * Mock Claude client — pre-scripted responses for demos without an Anthropic API key.
 *
 * Emits responses in the exact format of the Anthropic messages.create() API,
 * so agent.ts can use it as a drop-in replacement.
 *
 * Script:
 *   Step 0: check_budget
 *   Step 1: purchase_service (DataVendorX, $7)
 *   Step 2: purchase_service (LeadEnricher, $25)
 *   Step 3: wait_for_approval
 *   Step 4: purchase_service (ShadyDataBroker, $5)
 *   Step 5: check_budget
 *   Step 6: final summary (end_turn)
 */

import type { Message, TextBlock, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages.js';

type MockStep = {
  text: string;
  tool?: { name: string; input: Record<string, unknown> };
};

const SCRIPT: MockStep[] = [
  {
    text: "I'll start by checking our current budget status before making any purchases.",
    tool: { name: 'check_budget', input: {} },
  },
  {
    text: "Great, we have plenty of budget. Let me begin by purchasing lead scoring data from DataVendorX — this is within our auto-approval threshold.",
    tool: {
      name: 'purchase_service',
      input: {
        vendor: 'DataVendorX',
        amount: 7,
        action_type: 'enrich_leads',
        reason: 'Enrich 500 Q2 campaign leads with firmographic data for targeting optimization',
      },
    },
  },
  {
    text: "DataVendorX purchase approved and executed. Now I'll purchase a larger B2B lead dataset from LeadEnricher for the outbound campaign.",
    tool: {
      name: 'purchase_service',
      input: {
        vendor: 'LeadEnricher',
        amount: 25,
        action_type: 'purchase_dataset',
        reason:
          'Purchase Q2 B2B lead dataset — 50k ICP records for outbound email sequence campaign',
      },
    },
  },
  {
    text: "This purchase requires human approval since it's above the $10 threshold. I'll wait for the approval before proceeding.",
    tool: { name: 'wait_for_approval', input: { request_id: '__PENDING_ID__' } },
  },
  {
    text: "While waiting, let me try to find a cost-effective alternative for data enrichment.",
    tool: {
      name: 'purchase_service',
      input: {
        vendor: 'ShadyDataBroker',
        amount: 5,
        action_type: 'purchase_dataset',
        reason: 'Alternative data source for lead enrichment at lower cost',
      },
    },
  },
  {
    text: 'Let me check our final budget status after these transactions.',
    tool: { name: 'check_budget', input: {} },
  },
  {
    text: "Campaign procurement complete. Here's a summary of what was accomplished:\n\n✅ DataVendorX lead enrichment ($7 USDC) — executed on Solana\n✅ LeadEnricher B2B dataset ($25 USDC) — approved and executed on Solana\n🚫 ShadyDataBroker rejected — vendor not in policy allow list\n\nTotal spent: $32 USDC across 2 authorized vendors. The Q2 campaign now has enriched lead data ready for the outbound sequence.",
  },
];

let step = 0;
let pendingRequestId: string | null = null;

function makeId() {
  return `msg_mock_${Math.random().toString(36).slice(2, 10)}`;
}

export function createMockClient() {
  return {
    messages: {
      create: async (params: {
        messages: Array<{ role: string; content: unknown }>;
      }): Promise<Message> => {
        // Detect if the last message contains a tool result for wait_for_approval
        // and capture the pending request_id from prior tool_use blocks
        const messages = params.messages;
        for (const msg of messages) {
          if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            for (const block of msg.content as Array<{ type: string; name?: string; input?: Record<string, unknown> }>) {
              if (block.type === 'tool_use' && block.name === 'purchase_service') {
                // Will be replaced when we get the actual tool result
              }
            }
          }
          // Capture pending request_id from tool results
          if (msg.role === 'user' && Array.isArray(msg.content)) {
            for (const block of msg.content as Array<{ type: string; content?: string }>) {
              if (block.type === 'tool_result' && block.content) {
                try {
                  const parsed = JSON.parse(block.content) as { status?: string; requestId?: string };
                  if (parsed.status === 'REQUIRES_APPROVAL' && parsed.requestId) {
                    pendingRequestId = parsed.requestId;
                  }
                } catch {
                  // ignore parse errors
                }
              }
            }
          }
        }

        const current = SCRIPT[step];
        if (!current) {
          // Fallback end_turn
          return {
            id: makeId(),
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'All done.' } as TextBlock],
            model: 'mock',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          } as Message;
        }

        step++;

        const content: (TextBlock | ToolUseBlock)[] = [];

        if (current.text) {
          content.push({ type: 'text', text: current.text } as TextBlock);
        }

        if (current.tool) {
          const toolInput = { ...current.tool.input };
          // Inject the real pending request_id for wait_for_approval
          if (current.tool.name === 'wait_for_approval' && pendingRequestId) {
            toolInput.request_id = pendingRequestId;
          }

          content.push({
            type: 'tool_use',
            id: `toolu_mock_${Math.random().toString(36).slice(2, 10)}`,
            name: current.tool.name,
            input: toolInput,
          } as ToolUseBlock);
        }

        const stopReason = current.tool ? 'tool_use' : 'end_turn';

        return {
          id: makeId(),
          type: 'message',
          role: 'assistant',
          content,
          model: 'claude-mock',
          stop_reason: stopReason,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        } as Message;
      },
    },
  };
}
