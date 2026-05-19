/**
 * Simple Agent — exemplo mínimo de agente consumindo @aegis/sdk.
 *
 * Demonstra:
 *  1. Inicialização do AegisClient
 *  2. Pagamento simples via aegis.pay() — caso APPROVED
 *  3. Tratamento de erros tipados (PolicyRejectedError, RateLimitError, etc.)
 *  4. Idempotência via key explícita (retry seguro)
 *  5. Fluxo HTTP 402: mock vendor retorna 402 → parseHttp402 → payInvoice
 *
 * Pré-requisitos:
 *  - Aegis API rodando (default: http://localhost:4000)
 *  - .env.local com AEGIS_API_KEY (rode `pnpm --filter @aegis/api db:seed` para obter)
 *  - VENDOR_ID de um vendor cadastrado com wallet sponsored ACTIVE
 *
 * Uso:
 *   cp .env.example .env.local
 *   # edite .env.local com AEGIS_API_KEY e VENDOR_ID
 *   pnpm --filter simple-agent start
 */

import 'dotenv/config';
import {
  AegisClient,
  IdempotencyConflictError,
  NetworkError,
  parseHttp402,
  payInvoice,
  PolicyRejectedError,
  RateLimitError,
  UnauthorizedError,
  type Http402Invoice,
} from '@aegis/sdk';

// ===== Config =====
const API_KEY = process.env.AEGIS_API_KEY;
const BASE_URL = process.env.AEGIS_API_URL ?? 'http://localhost:4000';
const VENDOR_ID = process.env.VENDOR_ID;

if (!API_KEY) {
  console.error('❌ AEGIS_API_KEY não configurada. Veja .env.example.');
  process.exit(1);
}
if (!VENDOR_ID) {
  console.error('❌ VENDOR_ID não configurada. Cadastre vendor via API e copie o id.');
  process.exit(1);
}

const aegis = new AegisClient({ apiKey: API_KEY, baseUrl: BASE_URL });

// ===== Demo 1 — Pagamento simples =====
async function demoSimplePayment(): Promise<void> {
  console.log('\n📦 Demo 1: Pagamento simples (amount baixo, deve APPROVED)');
  try {
    const result = await aegis.pay(
      {
        vendorId: VENDOR_ID!,
        amountCents: 500,
        asset: 'USDC',
        actionType: 'api-call',
        reason: 'Demo simple-agent: pagamento direto sem 402',
        metadata: { demo: 'simple-payment' },
      },
      { idempotencyKey: aegis.generateIdempotencyKey() },
    );

    console.log(`   status=${result.status}`);
    console.log(`   decision=${result.decision}`);
    if (result.txHash) {
      console.log(`   txHash=${result.txHash}`);
      console.log(`   ${result.stellarExpertUrl}`);
    } else if (result.failureReason) {
      console.log(`   failureReason=${result.failureReason}`);
    }
  } catch (err) {
    handleError(err);
  }
}

// ===== Demo 2 — HTTP 402 flow (vendor mock) =====
async function demoHttp402Flow(): Promise<void> {
  console.log('\n📦 Demo 2: Fluxo HTTP 402 (vendor mock retorna invoice)');

  // Simula um vendor retornando 402 com invoice
  const mockVendorResponse = new Response(
    JSON.stringify({
      amount: 0.5, // 50 cents
      asset: 'USDC',
      to: 'GVENDOR_MOCK_PUBLIC_KEY',
      memo: 'invoice-mock-001',
      network: 'stellar-testnet',
    }),
    {
      status: 402,
      headers: { 'content-type': 'application/json' },
    },
  );

  try {
    const invoice: Http402Invoice = await parseHttp402(mockVendorResponse);
    console.log(`   invoice parsed: amountCents=${invoice.amountCents} asset=${invoice.asset}`);

    const result = await payInvoice(aegis, invoice, {
      vendorId: VENDOR_ID!,
      actionType: 'api-call',
      reason: 'Demo http-402: pagamento de invoice mock',
    });

    console.log(`   status=${result.status}`);
    if (result.txHash) console.log(`   txHash=${result.txHash}`);
  } catch (err) {
    handleError(err);
  }
}

// ===== Demo 3 — Idempotência (retry seguro) =====
async function demoIdempotency(): Promise<void> {
  console.log('\n📦 Demo 3: Idempotência — 2 chamadas com mesma key não duplicam payment');
  const idempotencyKey = aegis.generateIdempotencyKey();
  console.log(`   idempotencyKey=${idempotencyKey}`);

  const input = {
    vendorId: VENDOR_ID!,
    amountCents: 100,
    asset: 'USDC',
    actionType: 'api-call',
    reason: 'Demo idempotency',
  };

  try {
    const first = await aegis.pay(input, { idempotencyKey });
    console.log(`   1ª chamada: status=${first.status} id=${first.id}`);

    const second = await aegis.pay(input, { idempotencyKey });
    console.log(`   2ª chamada: status=${second.status} id=${second.id}`);
    console.log(`   IDs iguais? ${first.id === second.id ? 'SIM (idempotência funcionou)' : 'NÃO'}`);
  } catch (err) {
    handleError(err);
  }
}

// ===== Error handler tipado =====
function handleError(err: unknown): void {
  if (err instanceof PolicyRejectedError) {
    console.log(`   ❌ Rejected: ${err.detail}`);
    console.log(`      rule: ${err.policyRuleViolated}, spendRequestId: ${err.spendRequestId}`);
  } else if (err instanceof RateLimitError) {
    console.log(`   ❌ Rate limited. Retry em ${err.retryAfterSeconds}s.`);
  } else if (err instanceof IdempotencyConflictError) {
    console.log(`   ❌ Idempotency conflict: ${err.idempotencyKey} (body diferente)`);
  } else if (err instanceof UnauthorizedError) {
    console.log(`   ❌ Unauthorized: ${err.detail} (verifique AEGIS_API_KEY)`);
  } else if (err instanceof NetworkError) {
    console.log(`   ❌ Network error: ${err.detail} (Aegis API rodando?)`);
  } else if (err instanceof Error) {
    console.log(`   ❌ Erro inesperado: ${err.name}: ${err.message}`);
  } else {
    console.log(`   ❌ Erro desconhecido: ${String(err)}`);
  }
}

// ===== Main =====
async function main(): Promise<void> {
  console.log('🤖 Aegis simple-agent demo');
  console.log(`   API: ${BASE_URL}`);
  console.log(`   Agent prefix: ${API_KEY!.slice(0, 11)}…`);
  console.log(`   Vendor: ${VENDOR_ID}`);

  await demoSimplePayment();
  await demoHttp402Flow();
  await demoIdempotency();

  console.log('\n✅ Demos finalizados.');
}

main().catch((e) => {
  console.error('❌ Demo falhou:', e);
  process.exit(1);
});
