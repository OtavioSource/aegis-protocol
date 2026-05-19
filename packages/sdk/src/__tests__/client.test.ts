import { describe, expect, it, vi } from 'vitest';

import { AegisClient } from '../client.js';
import {
  IdempotencyConflictError,
  NetworkError,
  PolicyRejectedError,
  RateLimitError,
  UnauthorizedError,
} from '../errors.js';

const API_KEY = 'cr_test_AAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BASE_URL = 'https://aegis-test.example';

function makeJsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function makeProblemResponse(
  status: number,
  type: string,
  detail: string,
  extras: Record<string, unknown> = {},
) {
  return new Response(
    JSON.stringify({
      type: `https://aegis-protocol.dev/errors/${type}`,
      title: 'Test error',
      status,
      detail,
      ...extras,
    }),
    {
      status,
      headers: { 'content-type': 'application/problem+json' },
    },
  );
}

describe('AegisClient', () => {
  describe('construction', () => {
    it('rejects apiKey ausente', () => {
      // @ts-expect-error testando entrada inválida
      expect(() => new AegisClient({ apiKey: '' })).toThrow(/apiKey is required/);
    });

    it('rejects apiKey sem prefixo cr_', () => {
      expect(() => new AegisClient({ apiKey: 'invalid-key' })).toThrow(/must start with "cr_"/);
    });

    it('accepts apiKey válida', () => {
      const c = new AegisClient({ apiKey: API_KEY });
      expect(c).toBeInstanceOf(AegisClient);
    });
  });

  describe('pay()', () => {
    it('envia POST com headers corretos e body', async () => {
      let capturedUrl = '';
      let capturedInit: RequestInit | null = null;
      const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedInit = init ?? null;
        return makeJsonResponse(201, {
          id: 'sr-1',
          status: 'EXECUTED',
          decision: 'APPROVED',
          decisionReason: null,
          amountCents: 500,
          asset: 'USDC',
          actionType: 'api-call',
          reason: null,
          vendorId: 'v-1',
          agentId: 'a-1',
          policyId: 'p-1',
          txHash: '0xdeadbeef',
          ledger: 100,
          stellarExpertUrl: 'https://stellar.expert/...',
          executedAt: '2026-05-19T00:00:00Z',
          failureReason: null,
          createdAt: '2026-05-19T00:00:00Z',
          evaluatedAt: '2026-05-19T00:00:00Z',
        });
      });

      const client = new AegisClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: mockFetch });
      const result = await client.pay(
        { vendorId: 'v-1', amountCents: 500, asset: 'USDC', actionType: 'api-call' },
        { idempotencyKey: 'aaaa-bbbb-cccc-dddd' },
      );

      expect(capturedUrl).toBe(`${BASE_URL}/v1/spend-requests`);
      const init = capturedInit as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Bearer ${API_KEY}`);
      expect(headers['Idempotency-Key']).toBe('aaaa-bbbb-cccc-dddd');
      expect(headers['Content-Type']).toBe('application/json');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toMatchObject({
        vendorId: 'v-1',
        amountCents: 500,
      });
      expect(result.status).toBe('EXECUTED');
      expect(result.txHash).toBe('0xdeadbeef');
    });

    it('gera idempotencyKey automaticamente quando omitida', async () => {
      let captured: Record<string, string> = {};
      const mockFetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
        captured = init?.headers as Record<string, string>;
        return makeJsonResponse(201, {
          id: 'sr-1',
          status: 'APPROVED',
          decision: 'APPROVED',
          decisionReason: null,
          amountCents: 100,
          asset: 'USDC',
          actionType: 'x',
          reason: null,
          vendorId: 'v',
          agentId: 'a',
          policyId: 'p',
          txHash: null,
          ledger: null,
          stellarExpertUrl: null,
          executedAt: null,
          failureReason: null,
          createdAt: '2026-05-19T00:00:00Z',
          evaluatedAt: '2026-05-19T00:00:00Z',
        });
      });
      const client = new AegisClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: mockFetch });
      await client.pay({ vendorId: 'v', amountCents: 100, asset: 'USDC', actionType: 'x' });
      expect(captured['Idempotency-Key']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('lança PolicyRejectedError em 422', async () => {
      const mockFetch = vi.fn(async () =>
        makeProblemResponse(422, 'policy-rejected', 'amount too high', {
          policyRuleViolated: 'maxPerTransactionCents',
          spendRequestId: 'sr-rej',
        }),
      );
      const client = new AegisClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: mockFetch });
      await expect(
        client.pay({ vendorId: 'v', amountCents: 100, asset: 'USDC', actionType: 'x' }),
      ).rejects.toMatchObject({
        name: 'PolicyRejectedError',
        statusCode: 422,
        policyRuleViolated: 'maxPerTransactionCents',
        spendRequestId: 'sr-rej',
      });

      try {
        await client.pay({ vendorId: 'v', amountCents: 100, asset: 'USDC', actionType: 'x' });
      } catch (e) {
        expect(e).toBeInstanceOf(PolicyRejectedError);
      }
    });

    it('lança IdempotencyConflictError em 409 com type=idempotency-key-conflict', async () => {
      const mockFetch = vi.fn(async () =>
        makeProblemResponse(409, 'idempotency-key-conflict', 'reused with diff body', {
          idempotencyKey: 'aaaa-bbbb',
        }),
      );
      const client = new AegisClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: mockFetch });
      try {
        await client.pay({ vendorId: 'v', amountCents: 100, asset: 'USDC', actionType: 'x' });
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(IdempotencyConflictError);
        expect((e as IdempotencyConflictError).idempotencyKey).toBe('aaaa-bbbb');
      }
    });

    it('lança RateLimitError em 429 com retryAfterSeconds', async () => {
      const mockFetch = vi.fn(async () =>
        makeProblemResponse(429, 'rate-limit-exceeded', 'too many', { retryAfterSeconds: 42 }),
      );
      const client = new AegisClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: mockFetch });
      try {
        await client.pay({ vendorId: 'v', amountCents: 100, asset: 'USDC', actionType: 'x' });
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect((e as RateLimitError).retryAfterSeconds).toBe(42);
      }
    });

    it('lança UnauthorizedError em 401', async () => {
      const mockFetch = vi.fn(async () =>
        makeProblemResponse(401, 'unauthorized', 'invalid key'),
      );
      const client = new AegisClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: mockFetch });
      await expect(
        client.pay({ vendorId: 'v', amountCents: 100, asset: 'USDC', actionType: 'x' }),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('lança NetworkError em falha de fetch', async () => {
      const mockFetch = vi.fn(async () => {
        throw new TypeError('fetch failed: ECONNREFUSED');
      });
      const client = new AegisClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: mockFetch });
      await expect(
        client.pay({ vendorId: 'v', amountCents: 100, asset: 'USDC', actionType: 'x' }),
      ).rejects.toBeInstanceOf(NetworkError);
    });
  });

  describe('listSpendRequests()', () => {
    it('serializa query params corretamente', async () => {
      let capturedUrl = '';
      const mockFetch = vi.fn(async (input: string | URL | Request) => {
        capturedUrl = String(input);
        return makeJsonResponse(200, { data: [] });
      });
      const client = new AegisClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: mockFetch });
      await client.listSpendRequests({
        status: 'EXECUTED' as never, // string literal cast — enum vem do @aegis/shared via tipo
        vendorId: 'v-1',
        limit: 10,
      });
      expect(capturedUrl).toBe(`${BASE_URL}/v1/spend-requests?status=EXECUTED&vendorId=v-1&limit=10`);
    });
  });

  describe('generateIdempotencyKey()', () => {
    it('gera UUID v4 válido', () => {
      const client = new AegisClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: vi.fn() });
      const key = client.generateIdempotencyKey();
      expect(key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });
  });
});
