/**
 * Tests for x402 facilitator routes.
 *
 * Builds a minimal Fastify app with only x402Route registered.
 * Mocks @x402/stellar so no real Stellar RPC calls are made.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted; factories must NOT reference outer variables.
// ---------------------------------------------------------------------------

vi.mock('../../env.js', () => ({
  env: {
    TREASURY_SECRET: 'SCZANGBA5YDEETCEUOS4TSBQ4WKP3DLK4XUFAIWVYNLDPXFIGMTKZOE',
    STELLAR_NETWORK: 'testnet',
    SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  },
}));

// The facilitator mock instance: vi.fn() handles are created once here.
// They are returned from every ExactStellarScheme constructor call.
// We use vi.fn() calls without external references — hoisting-safe.
vi.mock('@x402/stellar/exact/facilitator', () => {
  const mockInstance = {
    verify: vi.fn(),
    settle: vi.fn(),
  };
  return {
    ExactStellarScheme: vi.fn(() => mockInstance),
    __mockInstance: mockInstance,
  };
});

vi.mock('@x402/stellar', () => ({
  createEd25519Signer: vi.fn(() => ({
    address: 'GCEZ6PZXQJMBZLNAXHPFHFQXQTQXQTXQTXQTXQTXQTXQTXQTXQTX',
    signAuthEntry: vi.fn(),
    signTransaction: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Import route and mocked modules AFTER vi.mock declarations
// ---------------------------------------------------------------------------
import x402Route from '../x402.js';

// Access the shared mock instance via the module
const facilitatorMod = await import('@x402/stellar/exact/facilitator');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFacilitator = (facilitatorMod as any).__mockInstance as {
  verify: ReturnType<typeof vi.fn>;
  settle: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockPayload = {
  x402Version: 2,
  scheme: 'exact',
  network: 'stellar:testnet',
  payload: { transaction: 'AAAA...base64xdr...' },
  accepted: { scheme: 'exact', network: 'stellar:testnet' },
};

const mockRequirements = {
  scheme: 'exact',
  network: 'stellar:testnet',
  payTo: 'GCEZ6PZXQJMBZLNAXHPFHFQXQTQX',
  amount: '5000000',
  asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(x402Route);
  return app;
}

// ---------------------------------------------------------------------------
// Tests: POST /v1/x402/verify
// ---------------------------------------------------------------------------

describe('POST /v1/x402/verify', () => {
  beforeEach(() => {
    mockFacilitator.verify.mockReset();
    mockFacilitator.settle.mockReset();
  });

  it('returns { isValid: true } for a valid transaction', async () => {
    mockFacilitator.verify.mockResolvedValue({
      isValid: true,
      invalidReason: null,
      payer: 'GPAYER...',
    });
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      payload: { payload: mockPayload, requirements: mockRequirements },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).isValid).toBe(true);
  });

  it('returns { isValid: false } for an invalid transaction', async () => {
    mockFacilitator.verify.mockResolvedValue({
      isValid: false,
      invalidReason: 'transaction_not_found',
      payer: undefined,
    });
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      payload: { payload: mockPayload, requirements: mockRequirements },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('transaction_not_found');
  });

  it('returns 400 with invalid_request on malformed body', async () => {
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      payload: { wrong: 'body' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('invalid_request');
  });

  it('returns 400 with verification_failed when verify throws', async () => {
    mockFacilitator.verify.mockRejectedValue(new Error('Stellar RPC error'));
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      payload: { payload: mockPayload, requirements: mockRequirements },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('verification_failed');
  });

  it('passes payload and requirements to the facilitator', async () => {
    mockFacilitator.verify.mockResolvedValue({ isValid: true, payer: 'GPAYER...' });
    const app = await buildTestApp();

    await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      payload: { payload: mockPayload, requirements: mockRequirements },
    });

    expect(mockFacilitator.verify).toHaveBeenCalledOnce();
    const [calledPayload, calledRequirements] = mockFacilitator.verify.mock.calls[0] ?? [];
    expect(calledPayload).toMatchObject({ x402Version: 2, scheme: 'exact' });
    expect(calledRequirements).toMatchObject({ payTo: mockRequirements.payTo });
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /v1/x402/settle
// ---------------------------------------------------------------------------

describe('POST /v1/x402/settle', () => {
  beforeEach(() => {
    mockFacilitator.verify.mockReset();
    mockFacilitator.settle.mockReset();
  });

  it('returns success response on happy path', async () => {
    mockFacilitator.settle.mockResolvedValue({
      success: true,
      transaction: 'abc123txhash',
      network: 'stellar:testnet',
      payer: 'GPAYER...',
    });
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/settle',
      payload: { payload: mockPayload, requirements: mockRequirements },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.transaction).toBe('abc123txhash');
  });

  it('returns 400 with settle_failed when settle throws', async () => {
    mockFacilitator.settle.mockRejectedValue(new Error('Network timeout'));
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/settle',
      payload: { payload: mockPayload, requirements: mockRequirements },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('settle_failed');
  });

  it('returns 400 with invalid_request on malformed body', async () => {
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/settle',
      payload: { bad: 'payload' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('invalid_request');
  });

  it('forwards settle failure from facilitator (success: false)', async () => {
    mockFacilitator.settle.mockResolvedValue({
      success: false,
      network: 'stellar:testnet',
      transaction: '',
      errorReason: 'verification_failed',
    });
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/settle',
      payload: { payload: mockPayload, requirements: mockRequirements },
    });

    // facilitator returned success: false — route returns 200, caller checks body
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(false);
  });
});
