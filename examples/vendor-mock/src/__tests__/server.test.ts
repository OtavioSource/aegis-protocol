import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../server.js';

describe('vendor-mock server', () => {
  const app = buildServer({ priceCents: 5, asset: 'USDC' });

  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('returns 402 with invoice when no proof header', async () => {
    const response = await app.inject({ method: 'GET', url: '/resource' });
    expect(response.statusCode).toBe(402);
    const body = response.json<Record<string, unknown>>();
    expect(body.amount).toBe(0.05);
    expect(body.asset).toBe('USDC');
    expect(typeof body.memo).toBe('string');
    expect(typeof body.expires_at).toBe('string');
  });

  it('returns 402 when proof header is not a 64-char hex string', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/resource',
      headers: { 'x-payment-proof': 'not-a-valid-hash' },
    });
    expect(response.statusCode).toBe(402);
  });

  it('returns 200 with resource when proof is valid 64-char hex txHash', async () => {
    const validTxHash = 'a'.repeat(64);
    const response = await app.inject({
      method: 'GET',
      url: '/resource',
      headers: { 'x-payment-proof': validTxHash },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(body.data).toBeDefined();
    expect(body.paymentProofReceived).toBe(validTxHash);
  });

  it('GET /healthz returns ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });
});
