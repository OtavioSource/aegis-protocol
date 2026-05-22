/**
 * Claude tool_use agent demo — HTTP 402 end-to-end.
 *
 * Fluxo demonstrado:
 *  1. Claude chama call_vendor_api → vendor retorna 402 com invoice
 *  2. Claude chama pay_with_aegis → Aegis paga USDC on-chain → retorna txHash
 *  3. Claude chama call_vendor_api com X-Payment-Proof → vendor libera recurso
 *  4. Claude retorna o recurso ao usuário
 *
 * Pré-requisitos:
 *  - vendor-mock rodando: pnpm --filter vendor-mock start
 *  - Aegis API rodando:   pnpm --filter @aegis/api dev
 *  - .env.local com ANTHROPIC_API_KEY, AEGIS_API_KEY, AEGIS_VENDOR_ID
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { AegisClient } from '@aegis/sdk';

// ===== Config =====

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AEGIS_API_KEY = process.env.AEGIS_API_KEY;
const AEGIS_API_URL = process.env.AEGIS_API_URL ?? 'http://localhost:4000';
const AEGIS_VENDOR_ID = process.env.AEGIS_VENDOR_ID;
const VENDOR_MOCK_URL = process.env.VENDOR_MOCK_URL ?? 'http://localhost:4001';

if (!ANTHROPIC_API_KEY) { console.error('❌ ANTHROPIC_API_KEY não configurada'); process.exit(1); }
if (!AEGIS_API_KEY)     { console.error('❌ AEGIS_API_KEY não configurada');     process.exit(1); }
if (!AEGIS_VENDOR_ID)   { console.error('❌ AEGIS_VENDOR_ID não configurado');   process.exit(1); }

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const aegis = new AegisClient({ apiKey: AEGIS_API_KEY, baseUrl: AEGIS_API_URL });

// ===== Tool definitions =====

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'call_vendor_api',
    description:
      'Faz uma requisição HTTP GET ao vendor para obter dados de mercado. ' +
      'Se o vendor retornar 402, retorna o invoice de pagamento. ' +
      'Se payment_proof for fornecido, envia no header X-Payment-Proof.',
    input_schema: {
      type: 'object' as const,
      properties: {
        payment_proof: {
          type: 'string',
          description: 'txHash de pagamento (64 chars hex). Omitir na primeira chamada.',
        },
      },
      required: [],
    },
  },
  {
    name: 'pay_with_aegis',
    description:
      'Paga uma invoice HTTP 402 usando o Aegis Protocol. ' +
      'Retorna txHash quando pagamento USDC é executado on-chain.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount_cents: {
          type: 'number',
          description: 'Valor em centavos (ex: 5 = $0.05 USDC)',
        },
        asset: {
          type: 'string',
          description: 'Asset code (ex: USDC)',
        },
        memo: {
          type: 'string',
          description: 'Memo do invoice (ex: invoice-abc123)',
        },
      },
      required: ['amount_cents', 'asset'],
    },
  },
];

// ===== Tool handlers =====

interface CallVendorInput { payment_proof?: string }
interface PayWithAegisInput { amount_cents: number; asset: string; memo?: string }

async function handleCallVendorApi(input: CallVendorInput): Promise<string> {
  const headers: Record<string, string> = {};
  if (input.payment_proof) {
    headers['X-Payment-Proof'] = input.payment_proof;
  }

  const response = await fetch(`${VENDOR_MOCK_URL}/resource`, { method: 'GET', headers });

  if (response.status === 402) {
    const body = await response.json() as Record<string, unknown>;
    return JSON.stringify({ status: 402, message: 'Payment required', invoice: body });
  }

  if (response.ok) {
    const body = await response.json() as Record<string, unknown>;
    return JSON.stringify({ status: 200, data: body });
  }

  return JSON.stringify({ status: response.status, error: 'Unexpected response from vendor' });
}

async function handlePayWithAegis(input: PayWithAegisInput): Promise<string> {
  try {
    const result = await aegis.pay({
      vendorId: AEGIS_VENDOR_ID!,
      amountCents: input.amount_cents,
      asset: input.asset,
      actionType: 'api-call',
      reason: `HTTP 402 invoice: ${input.memo ?? 'no memo'} — ${input.amount_cents} cents ${input.asset}`,
    });

    if (result.status === 'EXECUTED') {
      return JSON.stringify({
        status: 'EXECUTED',
        txHash: result.txHash,
        ledger: result.ledger,
        stellarExpertUrl: result.stellarExpertUrl,
      });
    }

    if (result.status === 'REQUIRES_APPROVAL') {
      return JSON.stringify({
        status: 'REQUIRES_APPROVAL',
        requestId: result.id,
        message: 'Payment pending human approval in Aegis dashboard',
      });
    }

    return JSON.stringify({ status: result.status, decision: result.decision });
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

async function processToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<string> {
  if (toolName === 'call_vendor_api') {
    return await handleCallVendorApi(toolInput as CallVendorInput);
  }
  if (toolName === 'pay_with_aegis') {
    return await handlePayWithAegis(toolInput as unknown as PayWithAegisInput);
  }
  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}

// ===== Agent loop =====

async function runAgent(): Promise<void> {
  console.log('\n🤖 Aegis HTTP 402 Demo — Claude tool_use agent');
  console.log(`   Vendor mock:  ${VENDOR_MOCK_URL}`);
  console.log(`   Aegis API:    ${AEGIS_API_URL}`);
  console.log(`   Vendor ID:    ${AEGIS_VENDOR_ID}`);
  console.log('');

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content:
        'Preciso dos dados de mercado atuais do vendor. ' +
        'Se o vendor pedir pagamento (HTTP 402), use a ferramenta pay_with_aegis para pagar automaticamente ' +
        'e depois tente novamente com a prova de pagamento. ' +
        'Reporte o resultado final.',
    },
  ];

  let iterationCount = 0;
  const MAX_ITERATIONS = 10;

  while (iterationCount < MAX_ITERATIONS) {
    iterationCount++;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      tools: TOOLS,
      messages,
    });

    console.log(`\n[iter ${iterationCount}] stop_reason=${response.stop_reason}`);

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    for (const block of toolUseBlocks) {
      console.log(`   tool: ${block.name}(${JSON.stringify(block.input)})`);
    }

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      if (textBlocks.length > 0) {
        console.log('\n✅ Resposta do agente:');
        console.log(textBlocks.map((b) => b.text).join('\n'));
      }
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        const result = await processToolCall(block.name, block.input as Record<string, unknown>);
        const preview = result.length > 120 ? result.slice(0, 120) + '...' : result;
        console.log(`   result: ${preview}`);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }

  if (iterationCount >= MAX_ITERATIONS) {
    console.error('❌ Agente excedeu máximo de iterações');
    process.exit(1);
  }
}

runAgent().catch((err) => {
  console.error('❌ Agent falhou:', err);
  process.exit(1);
});
