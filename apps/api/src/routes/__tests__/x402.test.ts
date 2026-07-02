/**
 * Tests for x402 facilitator routes.
 *
 * Builds a minimal Fastify app with only x402Route registered.
 * Mocks @x402/stellar so no real Stellar RPC calls are made.
 * `requireAgent` e `app.prisma` são stubados por injeção (o auth-agent/prisma
 * reais não são registrados aqui).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

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

import x402Route from '../x402.js';

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
  // NÃO é um txHash (64 hex) → cai no caminho canônico do facilitator.
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

/**
 * Monta o app de teste com stubs injetáveis:
 * - `authed`: simula um agente autenticado (para /settle, que exige requireAgent).
 * - `prisma`: injeta um mock de app.prisma (para o caminho pay-first do verify).
 */
async function buildTestApp(
  opts: { authed?: boolean; prisma?: unknown } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('agent', undefined);
  app.decorateRequest('requireAgent', function (this: { agent?: unknown }) {
    if (!this.agent) {
      const e = Object.assign(new Error('Authentication required'), { statusCode: 401 });
      throw e;
    }
    return this.agent;
  });
  if (opts.prisma) app.decorate('prisma', opts.prisma);
  if (opts.authed) {
    app.addHook('preHandler', async (req) => {
      (req as { agent?: unknown }).agent = {
        id: 'agent-1',
        companyId: 'co-1',
        apiKeyPrefix: 'cr_testkey1',
      };
    });
  }
  await app.register(x402Route);
  return app;
}

// ---------------------------------------------------------------------------
// Tests: POST /v1/x402/verify — caminho canônico (facilitator)
// ---------------------------------------------------------------------------

describe('POST /v1/x402/verify', () => {
  beforeEach(() => {
    mockFacilitator.verify.mockReset();
    mockFacilitator.settle.mockReset();
  });

  it('returns { isValid: true } for a valid transaction', async () => {
    mockFacilitator.verify.mockResolvedValue({ isValid: true, invalidReason: null });
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
    });
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      payload: { payload: mockPayload, requirements: mockRequirements },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).invalidReason).toBe('transaction_not_found');
  });

  it('returns 400 with invalid_request on malformed body', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      payload: { wrong: 'body' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('invalid_request');
  });

  it('returns 400 with verification_failed when verify throws (no leak)', async () => {
    mockFacilitator.verify.mockRejectedValue(new Error('Stellar RPC secret-ish error'));
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      payload: { payload: mockPayload, requirements: mockRequirements },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('verification_failed');
    // Info-leak fix: o detalhe interno NÃO deve vazar.
    expect(body.detail).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /v1/x402/verify — caminho pay-first (anti-replay ancorado no DB)
// ---------------------------------------------------------------------------

describe('POST /v1/x402/verify (pay-first, anti-replay)', () => {
  const validTxHash = 'a'.repeat(64);
  const payTo = 'GVENDORWALLETPUBKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const payload = { ...mockPayload, payload: { transaction: validTxHash } };
  const requirements = { ...mockRequirements, payTo, amount: '0.05', asset: 'USDC:ISSUER' };

  function makePrisma(overrides?: { updateManyCounts?: number[] }) {
    const counts = overrides?.updateManyCounts ?? [1];
    let call = 0;
    return {
      spendRequest: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'sr-1',
          status: 'EXECUTED',
          amountCents: 5n,
          asset: 'USDC',
          vendorWallet: { publicKey: payTo },
        }),
        updateMany: vi.fn().mockImplementation(async () => ({
          count: counts[Math.min(call++, counts.length - 1)],
        })),
      },
    };
  }

  it('valida um txHash real do Aegis e consome a prova (isValid: true)', async () => {
    const app = await buildTestApp({ prisma: makePrisma({ updateManyCounts: [1] }) });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      payload: { payload, requirements },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).isValid).toBe(true);
  });

  it('rejeita replay: a MESMA prova apresentada 2x (proof_already_redeemed)', async () => {
    // updateMany: 1ª resgata (count 1), 2ª já consumida (count 0).
    const app = await buildTestApp({ prisma: makePrisma({ updateManyCounts: [1, 0] }) });
    const first = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      payload: { payload, requirements },
    });
    expect(JSON.parse(first.body).isValid).toBe(true);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      payload: { payload, requirements },
    });
    const body = JSON.parse(second.body);
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('proof_already_redeemed');
  });

  it('rejeita se o destino (payTo) não bate com o pagamento real', async () => {
    const app = await buildTestApp({ prisma: makePrisma() });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      payload: { payload, requirements: { ...requirements, payTo: 'GATTACKER' } },
    });
    expect(JSON.parse(res.body).invalidReason).toBe('payto_mismatch');
  });

  it('rejeita se o SpendRequest não existe / não está EXECUTED', async () => {
    const prisma = {
      spendRequest: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() },
    };
    const app = await buildTestApp({ prisma });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      payload: { payload, requirements },
    });
    expect(JSON.parse(res.body).invalidReason).toBe('payment_not_found_or_not_executed');
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /v1/x402/settle — agora exige agente autenticado
// ---------------------------------------------------------------------------

describe('POST /v1/x402/settle', () => {
  beforeEach(() => {
    mockFacilitator.verify.mockReset();
    mockFacilitator.settle.mockReset();
  });

  it('rejeita com 401 quando NÃO autenticado (settle é privativo)', async () => {
    const app = await buildTestApp(); // sem authed
    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/settle',
      payload: { payload: mockPayload, requirements: mockRequirements },
    });
    expect(res.statusCode).toBe(401);
    expect(mockFacilitator.settle).not.toHaveBeenCalled();
  });

  it('returns success response on happy path (autenticado)', async () => {
    mockFacilitator.settle.mockResolvedValue({
      success: true,
      transaction: 'abc123txhash',
      network: 'stellar:testnet',
    });
    const app = await buildTestApp({ authed: true });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/settle',
      payload: { payload: mockPayload, requirements: mockRequirements },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).transaction).toBe('abc123txhash');
  });

  it('returns 400 with settle_failed when settle throws (no leak)', async () => {
    mockFacilitator.settle.mockRejectedValue(new Error('Network timeout internal'));
    const app = await buildTestApp({ authed: true });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/settle',
      payload: { payload: mockPayload, requirements: mockRequirements },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('settle_failed');
    expect(body.detail).toBeUndefined();
  });

  it('returns 400 with invalid_request on malformed body (autenticado)', async () => {
    const app = await buildTestApp({ authed: true });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/settle',
      payload: { bad: 'payload' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('invalid_request');
  });
});
