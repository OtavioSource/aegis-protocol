import { describe, expect, it } from 'vitest';

import { parseHttp402 } from '../http-402.js';

function r402(body: unknown, contentType = 'application/json', headers: Record<string, string> = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 402,
    headers: { 'content-type': contentType, ...headers },
    // url é readonly na Response, mas o test consegue
  });
}

describe('parseHttp402', () => {
  it('rejeita responses não-402', async () => {
    const r = new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await expect(parseHttp402(r)).rejects.toThrow(/expected status 402/);
  });

  it('parseia body genérico { amount, asset, to, memo }', async () => {
    const r = r402({ amount: 1.5, asset: 'USDC', to: 'GVENDOR...', memo: 'inv-42' });
    const inv = await parseHttp402(r);
    expect(inv).toMatchObject({
      amountCents: 150,
      asset: 'USDC',
      recipient: 'GVENDOR...',
      memo: 'inv-42',
    });
  });

  it('aceita amount em centavos inteiros >= 100', async () => {
    const r = r402({ amount: 1500, asset: 'USDC', to: 'G...' });
    const inv = await parseHttp402(r);
    expect(inv.amountCents).toBe(1500);
  });

  it('aceita amount em dólares decimais', async () => {
    const r = r402({ amount: 12.34, asset: 'USDC', to: 'G...' });
    const inv = await parseHttp402(r);
    expect(inv.amountCents).toBe(1234);
  });

  it('parseia amount string com sufixo "cents"', async () => {
    const r = r402({ amount: '500 cents', asset: 'USDC', to: 'G...' });
    const inv = await parseHttp402(r);
    expect(inv.amountCents).toBe(500);
  });

  it('parseia x402 (Coinbase): body com accepts[]', async () => {
    const r = r402({
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'stellar-testnet',
          asset: 'USDC',
          amount: 0.05,
          payTo: 'GVENDORX402...',
          memo: 'x402-invoice-1',
        },
      ],
    });
    const inv = await parseHttp402(r);
    expect(inv).toMatchObject({
      amountCents: 5,
      asset: 'USDC',
      recipient: 'GVENDORX402...',
      network: 'stellar-testnet',
    });
  });

  it('parseia Stellar SEP-29-like: asset_code + destination', async () => {
    const r = r402({
      amount: 2.5,
      asset_code: 'EURC',
      destination: 'GDEST...',
      memo: 'sep29',
      network_passphrase: 'Test SDF Network ; September 2015',
    });
    const inv = await parseHttp402(r);
    expect(inv).toMatchObject({
      amountCents: 250,
      asset: 'EURC',
      recipient: 'GDEST...',
      memo: 'sep29',
    });
    expect(inv.network).toContain('Test SDF Network');
  });

  it('rejeita body irreconhecível', async () => {
    const r = r402({ totally: 'unrelated', shape: true });
    await expect(parseHttp402(r)).rejects.toThrow(/unrecognized invoice body shape/);
  });

  it('rejeita response sem body JSON nem WWW-Authenticate', async () => {
    const r = new Response('plain text', { status: 402, headers: { 'content-type': 'text/plain' } });
    await expect(parseHttp402(r)).rejects.toThrow(
      /no JSON body nor parseable WWW-Authenticate header/,
    );
  });

  it('preserva raw body para inspeção', async () => {
    const original = { amount: 1.5, asset: 'USDC', to: 'G...', customField: 'xyz' };
    const inv = await parseHttp402(r402(original));
    expect(inv.raw).toEqual(original);
  });

  it('rejeita amount inválido (não numérico)', async () => {
    const r = r402({ amount: 'banana', asset: 'USDC', to: 'G...' });
    await expect(parseHttp402(r)).rejects.toThrow(/invalid amount/);
  });
});
