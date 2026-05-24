/**
 * x402-protocol HTTP 402 helpers.
 *
 * Implements the x402 spec (github.com/coinbase/x402):
 * - Parse `X-PAYMENT-REQUIRED` header from a 402 response
 * - Build the `X-PAYMENT` header value after executing payment
 * - High-level `payX402` orchestrates parse → pay → build signature
 */

import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http';
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from '@x402/core/types';
import type { AegisClient } from './client.js';

export type { PaymentRequired, PaymentRequirements, PaymentPayload };

export class X402Error extends Error {
  constructor(
    public readonly code:
      | 'missing_payment_required_header'
      | 'invalid_payment_required_format'
      | 'requires_approval'
      | 'payment_execution_failed',
    public readonly detail?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'X402Error';
  }
}

/**
 * Parse the X-PAYMENT-REQUIRED header from a 402 response.
 * Returns the array of PaymentRequirements from accepts[].
 */
export function parsePaymentRequired(response: Response): PaymentRequirements[] {
  const header = response.headers.get('X-PAYMENT-REQUIRED');
  if (!header) throw new X402Error('missing_payment_required_header');
  try {
    const paymentRequired: PaymentRequired = decodePaymentRequiredHeader(header);
    return paymentRequired.accepts;
  } catch {
    throw new X402Error('invalid_payment_required_format');
  }
}

/**
 * Build the X-PAYMENT header value after Aegis executes the payment.
 */
export function buildPaymentSignature(
  txHash: string,
  requirement: PaymentRequirements,
): string {
  const payload: PaymentPayload = {
    x402Version: 1,
    accepted: requirement,
    payload: { transaction: txHash },
  };
  return encodePaymentSignatureHeader(payload);
}

/**
 * High-level: parse X-PAYMENT-REQUIRED → pay via Aegis → build X-PAYMENT signature.
 *
 * Selects the first `scheme === 'exact'` requirement, or falls back to the
 * first available requirement. Converts the x402 `amount` string to cents
 * for the Aegis API (treats value as a decimal dollar amount).
 */
export async function payX402(
  client: AegisClient,
  response: Response,
  opts: {
    vendorId: string;
    actionType: string;
    reason?: string;
    idempotencyKey?: string;
  },
): Promise<{ paymentSignature: string; txHash: string; spendRequestId: string }> {
  const requirements = parsePaymentRequired(response);
  const req = requirements.find((r) => r.scheme === 'exact') ?? requirements[0];
  if (!req) throw new X402Error('invalid_payment_required_format');

  // Convert x402 amount string (e.g. "0.005") to cents for Aegis API
  const amountFloat = parseFloat(req.amount);
  const amountCents = Math.round(amountFloat * 100);

  const result = await client.pay(
    {
      vendorId: opts.vendorId,
      actionType: opts.actionType,
      reason: opts.reason,
      amountCents,
      asset: req.asset,
      metadata: {
        x402Network: req.network,
        x402PayTo: req.payTo,
      },
    },
    { idempotencyKey: opts.idempotencyKey },
  );

  if (result.status === 'REQUIRES_APPROVAL') {
    throw new X402Error('requires_approval', { requestId: result.id });
  }
  if (result.status !== 'EXECUTED') {
    throw new X402Error('payment_execution_failed', { reason: result.failureReason });
  }

  return {
    paymentSignature: buildPaymentSignature(result.txHash!, req),
    txHash: result.txHash!,
    spendRequestId: result.id,
  };
}
