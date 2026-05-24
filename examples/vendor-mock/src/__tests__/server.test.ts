import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import { buildServer } from '../server.js';

const VENDOR_WALLET = 'GVENDORMOCK111AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FACILITATOR_URL = 'http://localhost:4000';

describe('vendor-mock server (x402)', () => {
  const app = buildServer({
    vendorWalletPublicKey: VENDOR_WALLET,
    facilitatorUrl: FACILITATOR_URL,
  });

  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('GET /resource without X-PAYMENT → 402 + X-PAYMENT-REQUIRED header', async () => {
    const response = await app.inject({ method: 'GET', url: '/resource' });
    expect(response.statusCode).toBe(402);
    const header = response.headers['x-payment-required'];
    expect(typeof header).toBe('string');
    expect((header as string).length).toBeGreaterThan(0);
  });

  it('GET /resource with valid X-PAYMENT, facilitator returns isValid:true → 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ isValid: true }),
    }));

    const response = await app.inject({
      method: 'GET',
      url: '/resource',
      headers: { 'x-payment': 'eyJ4NDAyVmVyc2lvbiI6MSwic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoic3RlbGxhci10ZXN0bmV0IiwicGF5bG9hZCI6eyJ0cmFuc2FjdGlvbiI6ImFiY2QifSwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoic3RlbGxhci10ZXN0bmV0IiwiYW1vdW50IjoiMC4wMDUiLCJyZXNvdXJjZSI6Ii9yZXNvdXJjZSIsInBheVRvIjoiR1ZFTkRPUiIsImFzc2V0IjoiVVNEQyIsIm1heFRpbWVvdXRTZWNvbmRzIjozMDAsImV4dHJhIjp7fX19' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(body.data).toBeDefined();
  });

  it('GET /resource with X-PAYMENT, facilitator returns isValid:false → 402 + X-PAYMENT-INVALID-REASON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ isValid: false, invalidReason: 'transaction_not_found' }),
    }));

    const response = await app.inject({
      method: 'GET',
      url: '/resource',
      headers: { 'x-payment': 'eyJ4NDAyVmVyc2lvbiI6MSwic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoic3RlbGxhci10ZXN0bmV0IiwicGF5bG9hZCI6eyJ0cmFuc2FjdGlvbiI6ImFiY2QifSwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoic3RlbGxhci10ZXN0bmV0IiwiYW1vdW50IjoiMC4wMDUiLCJyZXNvdXJjZSI6Ii9yZXNvdXJjZSIsInBheVRvIjoiR1ZFTkRPUiIsImFzc2V0IjoiVVNEQyIsIm1heFRpbWVvdXRTZWNvbmRzIjozMDAsImV4dHJhIjp7fX19' },
    });
    expect(response.statusCode).toBe(402);
    expect(response.headers['x-payment-invalid-reason']).toBe('transaction_not_found');
    expect(response.headers['x-payment-required']).toBeTruthy();
  });

  it('GET /resource with X-PAYMENT, fetch throws → 503', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

    const response = await app.inject({
      method: 'GET',
      url: '/resource',
      headers: { 'x-payment': 'eyJ4NDAyVmVyc2lvbiI6MSwic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoic3RlbGxhci10ZXN0bmV0IiwicGF5bG9hZCI6eyJ0cmFuc2FjdGlvbiI6ImFiY2QifSwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoic3RlbGxhci10ZXN0bmV0IiwiYW1vdW50IjoiMC4wMDUiLCJyZXNvdXJjZSI6Ii9yZXNvdXJjZSIsInBheVRvIjoiR1ZFTkRPUiIsImFzc2V0IjoiVVNEQyIsIm1heFRpbWVvdXRTZWNvbmRzIjozMDAsImV4dHJhIjp7fX19' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'facilitator_unavailable' });
  });

  it('GET /healthz returns ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });
});
