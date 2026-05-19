/**
 * HTTP 402 — helpers para extrair Invoice de uma response e pagar via Aegis.
 *
 * Formatos suportados:
 *
 * 1. **JSON body (genérico):**
 *    `{ amount, asset, to, memo, network }` — qualquer combinação dessas keys.
 *
 * 2. **x402 (Coinbase-style):**
 *    body `{ accepts: [{ scheme, network, asset, amount, payTo }] }`
 *    Pega o primeiro `scheme === 'exact'` ou o primeiro accepts disponível.
 *
 * 3. **Stellar SEP-29-like:**
 *    body `{ amount, asset_code, destination, memo, network_passphrase }`
 *
 * Para formatos não-padronizados, use `aegis.pay()` direto passando os
 * campos manualmente (não use parseHttp402).
 */

import type { AegisClient } from './client.js';
import type { Http402Invoice, PayInvoiceOptions, PayResult } from './types.js';

/**
 * Extrai uma `Http402Invoice` normalizada a partir de uma Response com
 * status 402. Lança se a response não for 402 ou o body for irreconhecível.
 *
 * Aceita Response com qualquer content-type — tenta JSON primeiro,
 * cai pra parse de cabeçalho `WWW-Authenticate` em último caso.
 */
export async function parseHttp402(response: Response): Promise<Http402Invoice> {
  if (response.status !== 402) {
    throw new Error(
      `parseHttp402: expected status 402, got ${response.status} (${response.url})`,
    );
  }

  let body: Record<string, unknown> | null = null;
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('json')) {
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = null;
    }
  }

  if (!body) {
    // Fallback: tenta parse do header WWW-Authenticate
    const auth = response.headers.get('www-authenticate');
    if (auth) {
      body = parseWwwAuthenticate(auth);
    }
  }

  if (!body) {
    throw new Error(
      'parseHttp402: response 402 has no JSON body nor parseable WWW-Authenticate header',
    );
  }

  return normalizeInvoice(body, response.url);
}

/**
 * Paga uma Invoice extraída via `parseHttp402`, usando o `vendorId` cadastrado
 * na Aegis (o `recipient` no Invoice é apenas debug; Aegis sempre paga pra
 * vendor.wallet.publicKey do DB).
 *
 * Retorna o `PayResult` do `aegis.pay()` — inclui `txHash` quando executado.
 */
export async function payInvoice(
  client: AegisClient,
  invoice: Http402Invoice,
  options: PayInvoiceOptions,
): Promise<PayResult> {
  return await client.pay(
    {
      vendorId: options.vendorId,
      amountCents: invoice.amountCents,
      asset: invoice.asset,
      actionType: options.actionType,
      reason: options.reason,
      metadata: {
        ...(options.metadata ?? {}),
        http402Source: invoice.source,
        http402Memo: invoice.memo,
      },
    },
    { idempotencyKey: options.idempotencyKey },
  );
}

// ===== Normalização =====

function normalizeInvoice(body: Record<string, unknown>, sourceUrl: string): Http402Invoice {
  // Caso x402 (Coinbase): { accepts: [{...}] }
  if (Array.isArray(body['accepts']) && body['accepts'].length > 0) {
    const accept = body['accepts'][0] as Record<string, unknown>;
    return {
      amountCents: parseAmountToCents(accept['amount']),
      asset: (accept['asset'] as string) ?? 'USDC',
      recipient: (accept['payTo'] as string | undefined) ?? null,
      memo: (accept['memo'] as string | undefined) ?? null,
      source: sourceUrl,
      network: (accept['network'] as string | undefined) ?? null,
      raw: body,
    };
  }

  // Caso Stellar SEP-29-like: { amount, asset_code, destination, ... }
  if (body['asset_code'] || body['destination']) {
    return {
      amountCents: parseAmountToCents(body['amount']),
      asset: (body['asset_code'] as string) ?? (body['asset'] as string) ?? 'USDC',
      recipient: (body['destination'] as string | undefined) ?? null,
      memo: (body['memo'] as string | undefined) ?? null,
      source: sourceUrl,
      network:
        (body['network_passphrase'] as string | undefined) ??
        (body['network'] as string | undefined) ??
        null,
      raw: body,
    };
  }

  // Caso genérico: { amount, asset, to, memo }
  if (body['amount'] !== undefined && (body['to'] !== undefined || body['asset'] !== undefined)) {
    return {
      amountCents: parseAmountToCents(body['amount']),
      asset: (body['asset'] as string) ?? 'USDC',
      recipient: (body['to'] as string | undefined) ?? null,
      memo: (body['memo'] as string | undefined) ?? null,
      source: sourceUrl,
      network: (body['network'] as string | undefined) ?? null,
      raw: body,
    };
  }

  throw new Error(
    `parseHttp402: unrecognized invoice body shape. Keys: [${Object.keys(body).join(', ')}]`,
  );
}

/**
 * Converte um valor de amount em centavos.
 * - number: trata como dólares (`1.50` → 150 cents)
 *           OU como centavos diretos se inteiro grande (`1500` → 1500 cents).
 *           Heurística: se for inteiro e >= 100, assume centavos; senão, dólares.
 * - string: parseFloat e converte conforme acima.
 *           **Exceção:** string com sufixo "c" ou "cents" força centavos.
 */
function parseAmountToCents(raw: unknown): number {
  if (typeof raw === 'number') {
    if (Number.isInteger(raw) && raw >= 100) return raw;
    return Math.round(raw * 100);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase();
    const isCents = trimmed.endsWith('c') || trimmed.endsWith('cents');
    const cleaned = trimmed.replace(/cents?$/, '').replace(/c$/, '').trim();
    const n = parseFloat(cleaned);
    if (Number.isNaN(n)) {
      throw new Error(`parseHttp402: invalid amount "${raw}"`);
    }
    if (isCents) return Math.round(n);
    if (Number.isInteger(n) && n >= 100) return n;
    return Math.round(n * 100);
  }
  throw new Error(`parseHttp402: amount must be number or string, got ${typeof raw}`);
}

/**
 * Parse minimal de `WWW-Authenticate` header com scheme `Bearer x402` ou similar.
 * Tenta extrair JSON inline em quoted-param.
 */
function parseWwwAuthenticate(header: string): Record<string, unknown> | null {
  // ex: `Bearer x402 realm="..." invoice="{\"amount\":1.50,...}"`
  const invoiceMatch = header.match(/invoice="([^"]+)"/);
  if (invoiceMatch && invoiceMatch[1]) {
    try {
      return JSON.parse(invoiceMatch[1].replace(/\\"/g, '"')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}
