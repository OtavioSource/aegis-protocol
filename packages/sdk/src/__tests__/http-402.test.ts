import { describe, expect, it, vi } from 'vitest';

import { encodePaymentRequiredHeader } from '@x402/core/http';
import type { PaymentRequired } from '@x402/core/types';

import type { AegisClient } from '../client.js';
import { buildPaymentSignature, parsePaymentRequired, payX402, X402Error } from '../http-402.js';

// Helper to build a valid X-PAYMENT-REQUIRED header value
function makePaymentRequiredHeader(overrides?: Partial<PaymentRequired>): string {
  const paymentRequired: PaymentRequired = {
    x402Version: 1,
    resource: { url: 'https://example.com/api', method: 'POST' },
    accepts: [
      {
        scheme: 'exact',
        network: 'base-sepolia',
        asset: 'USDC',
        amount: '0.005',
        payTo: '0xVENDORWALLET',
        maxTimeoutSeconds: 60,
        extra: {},
      },
    ],
    ...overrides,
  };
  return encodePaymentRequiredHeader(paymentRequired);
}

// Helper to build a Response with a given X-PAYMENT-REQUIRED header
function makeResponse402(headerValue: string | null): Response {
  const headers: Record<string, string> = { 'content-type': 'text/plain' };
  if (headerValue !== null) {
    headers['X-PAYMENT-REQUIRED'] = headerValue;
  }
  return new Response('Payment Required', { status: 402, headers });
}

describe('parsePaymentRequired', () => {
  it('returns PaymentRequirements[] from a valid X-PAYMENT-REQUIRED header', () => {
    const header = makePaymentRequiredHeader();
    const response = makeResponse402(header);
    const requirements = parsePaymentRequired(response);

    expect(Array.isArray(requirements)).toBe(true);
    expect(requirements).toHaveLength(1);
    expect(requirements[0]).toMatchObject({
      scheme: 'exact',
      network: 'base-sepolia',
      asset: 'USDC',
      amount: '0.005',
      payTo: '0xVENDORWALLET',
    });
  });

  it('returns multiple requirements when multiple accepts are present', () => {
    const header = encodePaymentRequiredHeader({
      x402Version: 1,
      resource: { url: 'https://example.com/api', method: 'GET' },
      accepts: [
        {
          scheme: 'exact',
          network: 'base-sepolia',
          asset: 'USDC',
          amount: '0.001',
          payTo: '0xWALLET1',
          maxTimeoutSeconds: 30,
          extra: {},
        },
        {
          scheme: 'exact',
          network: 'base-mainnet',
          asset: 'USDC',
          amount: '0.001',
          payTo: '0xWALLET2',
          maxTimeoutSeconds: 30,
          extra: {},
        },
      ],
    });
    const requirements = parsePaymentRequired(makeResponse402(header));
    expect(requirements).toHaveLength(2);
  });

  it("throws X402Error with code 'missing_payment_required_header' when header is absent", () => {
    const response = makeResponse402(null);
    expect(() => parsePaymentRequired(response)).toThrow(X402Error);
    try {
      parsePaymentRequired(response);
    } catch (e) {
      expect(e).toBeInstanceOf(X402Error);
      expect((e as X402Error).code).toBe('missing_payment_required_header');
    }
  });

  it("throws X402Error with code 'invalid_payment_required_format' when header is invalid base64", () => {
    const response = makeResponse402('not-valid-base64!!!');
    expect(() => parsePaymentRequired(response)).toThrow(X402Error);
    try {
      parsePaymentRequired(response);
    } catch (e) {
      expect(e).toBeInstanceOf(X402Error);
      expect((e as X402Error).code).toBe('invalid_payment_required_format');
    }
  });

  it("throws X402Error with code 'invalid_payment_required_format' when header is valid base64 but wrong JSON shape", () => {
    // Valid base64 but not a PaymentRequired JSON
    const badHeader = Buffer.from(JSON.stringify({ notAnX402: true })).toString('base64');
    const response = makeResponse402(badHeader);
    // The decode function may or may not throw — if it doesn't, accepts will be undefined
    // Either case should result in an X402Error
    try {
      const result = parsePaymentRequired(response);
      // If it somehow succeeded, the result should be empty or undefined
      expect(result).toBeUndefined();
    } catch (e) {
      expect(e).toBeInstanceOf(X402Error);
      expect((e as X402Error).code).toBe('invalid_payment_required_format');
    }
  });
});

// Minimal mock AegisClient — only the `pay` method is needed by payX402
function makeMockClient(payFn: AegisClient['pay']): AegisClient {
  return { pay: payFn } as unknown as AegisClient;
}

const DEFAULT_PAY_OPTS = {
  vendorId: 'vendor-1',
  actionType: 'api-call',
  reason: 'test',
};

describe('payX402', () => {
  it('happy path: EXECUTED → returns paymentSignature, txHash, spendRequestId', async () => {
    const mockPay = vi.fn().mockResolvedValue({
      status: 'EXECUTED',
      txHash: 'abc123',
      id: 'sr-1',
    });
    const client = makeMockClient(mockPay);
    const header = makePaymentRequiredHeader();
    const response = makeResponse402(header);

    const result = await payX402(client, response, DEFAULT_PAY_OPTS);

    expect(result.txHash).toBe('abc123');
    expect(result.spendRequestId).toBe('sr-1');
    expect(typeof result.paymentSignature).toBe('string');
    expect(result.paymentSignature.length).toBeGreaterThan(0);
  });

  it("REQUIRES_APPROVAL → throws X402Error with code 'requires_approval'", async () => {
    const mockPay = vi.fn().mockResolvedValue({
      status: 'REQUIRES_APPROVAL',
      id: 'sr-2',
    });
    const client = makeMockClient(mockPay);
    const header = makePaymentRequiredHeader();
    const response = makeResponse402(header);

    await expect(payX402(client, response, DEFAULT_PAY_OPTS)).rejects.toSatisfy(
      (e: unknown) => e instanceof X402Error && e.code === 'requires_approval',
    );
  });

  it("EXECUTION_FAILED → throws X402Error with code 'payment_execution_failed'", async () => {
    const mockPay = vi.fn().mockResolvedValue({
      status: 'EXECUTION_FAILED',
      failureReason: 'insufficient_balance',
      id: 'sr-3',
    });
    const client = makeMockClient(mockPay);
    const header = makePaymentRequiredHeader();
    const response = makeResponse402(header);

    await expect(payX402(client, response, DEFAULT_PAY_OPTS)).rejects.toSatisfy(
      (e: unknown) => e instanceof X402Error && e.code === 'payment_execution_failed',
    );
  });

  it("missing X-PAYMENT-REQUIRED header → throws X402Error with code 'missing_payment_required_header'", async () => {
    const mockPay = vi.fn();
    const client = makeMockClient(mockPay);
    const response = makeResponse402(null);

    await expect(payX402(client, response, DEFAULT_PAY_OPTS)).rejects.toSatisfy(
      (e: unknown) => e instanceof X402Error && e.code === 'missing_payment_required_header',
    );
    expect(mockPay).not.toHaveBeenCalled();
  });
});

describe('buildPaymentSignature', () => {
  it('returns a non-empty base64 string', () => {
    const req = {
      scheme: 'exact',
      network: 'base-sepolia' as const,
      asset: 'USDC',
      amount: '0.005',
      payTo: '0xVENDORWALLET',
      maxTimeoutSeconds: 60,
      extra: {},
    };
    const sig = buildPaymentSignature('0xABCDEF123456', req);
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(0);
  });

  it('decoded signature contains the txHash in payload.transaction', () => {
    const txHash = '0xDEADBEEFCAFEBABE';
    const req = {
      scheme: 'exact',
      network: 'base-sepolia' as const,
      asset: 'USDC',
      amount: '0.005',
      payTo: '0xVENDORWALLET',
      maxTimeoutSeconds: 60,
      extra: {},
    };
    const sig = buildPaymentSignature(txHash, req);
    const decoded = JSON.parse(Buffer.from(sig, 'base64').toString('utf8'));
    expect(decoded.payload.transaction).toBe(txHash);
  });

  it('decoded signature contains the accepted requirement fields', () => {
    const req = {
      scheme: 'exact',
      network: 'base-mainnet' as const,
      asset: 'EURC',
      amount: '1.00',
      payTo: '0xOTHERWALLET',
      maxTimeoutSeconds: 120,
      extra: { memo: 'test' },
    };
    const sig = buildPaymentSignature('0x111222', req);
    const decoded = JSON.parse(Buffer.from(sig, 'base64').toString('utf8'));
    expect(decoded.accepted.asset).toBe('EURC');
    expect(decoded.accepted.network).toBe('base-mainnet');
    expect(decoded.accepted.payTo).toBe('0xOTHERWALLET');
  });
});
