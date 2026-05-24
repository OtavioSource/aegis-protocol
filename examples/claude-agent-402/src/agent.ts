/**
 * Claude tool_use agent demo — HTTP 402 end-to-end (x402 protocol).
 *
 * Fluxo demonstrado:
 *  1. Claude chama call_vendor_api → vendor retorna 402 com X-PAYMENT-REQUIRED header
 *  2. Claude chama pay_with_aegis com paymentRequiredHeader → Aegis paga → retorna paymentSignature
 *  3. Claude chama call_vendor_api com payment_signature → vendor verifica via facilitador → 200
 *  4. Claude retorna o recurso ao usuário
 *
 * Pré-requisitos:
 *  - vendor-mock rodando: pnpm --filter vendor-mock start
 *  - Aegis API rodando:   pnpm --filter @aegis/api dev
 *  - .env.local com ANTHROPIC_API_KEY, AEGIS_API_KEY, AEGIS_VENDOR_ID
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { AegisClient, payX402, X402Error } from '@aegis/sdk';

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
      'Se o vendor retornar 402, retorna o header X-PAYMENT-REQUIRED. ' +
      'Se payment_signature for fornecido, envia no header X-PAYMENT para retry.',
    input_schema: {
      type: 'object' as const,
      properties: {
        payment_signature: {
          type: 'string',
          description: 'Valor do header X-PAYMENT (base64) retornado por pay_with_aegis. Omitir na primeira chamada.',
        },
      },
      required: [],
    },
  },
  {
    name: 'pay_with_aegis',
    description:
      'Paga um payment request x402 usando o Aegis Protocol. ' +
      'Recebe o valor raw do header X-PAYMENT-REQUIRED (base64). ' +
      'Retorna paymentSignature para usar no retry via X-PAYMENT.',
    input_schema: {
      type: 'object' as const,
      properties: {
        paymentRequiredHeader: {
          type: 'string',
          description: 'Valor raw do header X-PAYMENT-REQUIRED retornado pelo vendor (base64 encoded).',
        },
      },
      required: ['paymentRequiredHeader'],
    },
  },
];

// ===== Tool handlers =====

interface CallVendorInput { payment_signature?: string }
interface PayWithAegisInput { paymentRequiredHeader: string }

async function handleCallVendorApi(input: CallVendorInput): Promise<string> {
  try {
    const headers: Record<string, string> = {};
    if (input.payment_signature) {
      headers['X-PAYMENT'] = input.payment_signature;
    }

    const response = await fetch(`${VENDOR_MOCK_URL}/resource`, { method: 'GET', headers });

    if (response.status === 402) {
      const paymentRequiredHeader = response.headers.get('X-PAYMENT-REQUIRED');
      const invalidReason = response.headers.get('X-PAYMENT-INVALID-REASON');
      return JSON.stringify({
        status: 402,
        paymentRequiredHeader,
        ...(invalidReason ? { invalidReason } : {}),
      });
    }

    if (response.ok) {
      const body = await response.json() as Record<string, unknown>;
      return JSON.stringify({ status: 200, data: body });
    }

    return JSON.stringify({ status: response.status, error: 'Unexpected response from vendor' });
  } catch (err) {
    return JSON.stringify({ error: `Network error calling vendor: ${String(err)}` });
  }
}

async function handlePayWithAegis(input: PayWithAegisInput): Promise<string> {
  try {
    // Construct a fake 402 Response with the header so payX402 can parse it
    const fakeResponse = new Response(null, {
      status: 402,
      headers: { 'X-PAYMENT-REQUIRED': input.paymentRequiredHeader },
    });

    const result = await payX402(aegis, fakeResponse, {
      vendorId: AEGIS_VENDOR_ID!,
      actionType: 'api-call',
      reason: 'HTTP 402 x402 payment via claude-agent-402',
    });

    return JSON.stringify({
      status: 'EXECUTED',
      paymentSignature: result.paymentSignature,
      txHash: result.txHash,
      spendRequestId: result.spendRequestId,
    });
  } catch (err) {
    if (err instanceof X402Error) {
      if (err.code === 'requires_approval') {
        return JSON.stringify({
          status: 'REQUIRES_APPROVAL',
          requestId: (err.detail as any)?.requestId,
          message: 'Payment requires human approval. Stop and instruct the user to approve in the Aegis dashboard before retrying.',
        });
      }
      if (err.code === 'payment_execution_failed') {
        return JSON.stringify({
          status: 'EXECUTION_FAILED',
          message: 'Payment execution failed — do not retry.',
          detail: err.detail,
        });
      }
      return JSON.stringify({ status: 'ERROR', code: err.code, detail: err.detail });
    }
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
        'Se o vendor retornar 402, use pay_with_aegis passando o paymentRequiredHeader retornado. ' +
        'Depois faça retry com o payment_signature retornado no header X-PAYMENT. ' +
        'Se o pagamento precisar de aprovação humana, pare e informe o usuário. ' +
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
    } else {
      console.error(`❌ Unexpected stop_reason: ${response.stop_reason} — abortando`);
      break;
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
