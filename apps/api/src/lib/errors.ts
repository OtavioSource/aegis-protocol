/**
 * Custom error classes — serializam para RFC 7807 Problem Details.
 *
 * Toda exceção esperada da API estende `ApiError`. O error handler global
 * (apps/api/src/plugins/error-handler.ts) intercepta e formata.
 *
 * Erros inesperados (bugs) caem no fallback 500 sem vazar detalhes.
 */

import type { PolicyRuleName } from '@aegis/shared';

const ERROR_BASE_URL = 'https://aegis-protocol.dev/errors';

/** Base class — toda ApiError vira HTTP response RFC 7807. */
export abstract class ApiError extends Error {
  abstract readonly statusCode: number;
  abstract readonly type: string;
  abstract readonly title: string;
  readonly extras?: Record<string, unknown>;

  constructor(detail: string, extras?: Record<string, unknown>) {
    super(detail);
    this.name = this.constructor.name;
    this.extras = extras;
  }

  toProblem(instance?: string): Record<string, unknown> {
    return {
      type: `${ERROR_BASE_URL}/${this.type}`,
      title: this.title,
      status: this.statusCode,
      detail: this.message,
      ...(instance ? { instance } : {}),
      ...this.extras,
    };
  }
}

// ----- 4xx -----

export class ValidationError extends ApiError {
  readonly statusCode = 400;
  readonly type = 'validation-failed';
  readonly title = 'Request validation failed';
}

export class UnauthorizedError extends ApiError {
  readonly statusCode = 401;
  readonly type = 'unauthorized';
  readonly title = 'Unauthorized';
}

export class ForbiddenError extends ApiError {
  readonly statusCode = 403;
  readonly type = 'forbidden';
  readonly title = 'Forbidden';
}

export class NotFoundError extends ApiError {
  readonly statusCode = 404;
  readonly type = 'not-found';
  readonly title = 'Resource not found';
}

export class ConflictError extends ApiError {
  readonly statusCode = 409;
  readonly type = 'conflict';
  readonly title = 'Conflict';
}

export class IdempotencyConflictError extends ApiError {
  readonly statusCode = 409;
  readonly type = 'idempotency-key-conflict';
  readonly title = 'Idempotency-Key reused with different body';

  constructor(idempotencyKey: string) {
    super(`Idempotency-Key '${idempotencyKey}' was previously used with a different request body.`);
  }
}

export class PolicyRejectedError extends ApiError {
  readonly statusCode = 422;
  readonly type = 'policy-rejected';
  readonly title = 'Spend rejected by policy';

  constructor(
    detail: string,
    public readonly policyRuleViolated: PolicyRuleName,
    public readonly spendRequestId?: string,
  ) {
    super(detail, {
      policyRuleViolated,
      ...(spendRequestId ? { spendRequestId } : {}),
    });
  }
}

export class RateLimitError extends ApiError {
  readonly statusCode = 429;
  readonly type = 'rate-limit-exceeded';
  readonly title = 'Too many requests';

  constructor(detail: string, public readonly retryAfterSeconds: number) {
    super(detail, { retryAfterSeconds });
  }
}

// ----- 5xx -----

export class StellarError extends ApiError {
  readonly statusCode = 502;
  readonly type = 'stellar-error';
  readonly title = 'Upstream Stellar / Horizon error';
}

export class InternalError extends ApiError {
  readonly statusCode = 500;
  readonly type = 'internal-error';
  readonly title = 'Internal server error';
}
