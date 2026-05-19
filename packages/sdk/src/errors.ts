/**
 * Hierarquia de erros do @aegis/sdk.
 *
 * Cliente faz `instanceof` para reagir programaticamente:
 *
 * ```ts
 * try {
 *   await aegis.pay({...});
 * } catch (e) {
 *   if (e instanceof PolicyRejectedError) {
 *     console.log("Rejected:", e.detail, "rule:", e.policyRuleViolated);
 *   } else if (e instanceof RateLimitError) {
 *     await sleep(e.retryAfterSeconds * 1000);
 *   } else if (e instanceof NetworkError) {
 *     // retry com backoff
 *   } else {
 *     throw e;
 *   }
 * }
 * ```
 *
 * Todas as classes parseiam o body RFC 7807 Problem Details da API.
 */

/** Base de toda exceção lançada pelo SDK. */
export class AegisError extends Error {
  readonly statusCode: number;
  readonly type: string;
  readonly detail: string;
  readonly extras: Record<string, unknown>;

  constructor(params: {
    statusCode: number;
    type: string;
    title: string;
    detail: string;
    extras?: Record<string, unknown>;
  }) {
    super(params.detail || params.title);
    this.name = this.constructor.name;
    this.statusCode = params.statusCode;
    this.type = params.type;
    this.detail = params.detail;
    this.extras = params.extras ?? {};
  }
}

// ===== 4xx específicos =====

export class ValidationError extends AegisError {}

export class UnauthorizedError extends AegisError {}

export class ForbiddenError extends AegisError {}

export class NotFoundError extends AegisError {}

export class ConflictError extends AegisError {}

export class IdempotencyConflictError extends ConflictError {
  /** Idempotency-Key foi reutilizada com body diferente da request anterior. */
  readonly idempotencyKey: string;

  constructor(params: ConstructorParameters<typeof AegisError>[0] & { idempotencyKey: string }) {
    super(params);
    this.idempotencyKey = params.idempotencyKey;
  }
}

export class PolicyRejectedError extends AegisError {
  /** Nome canônico da regra de Policy que rejeitou (ex: "maxPerTransactionCents"). */
  readonly policyRuleViolated: string;
  /** ID da SpendRequest persistida (mesmo rejeitada, fica no audit log). */
  readonly spendRequestId?: string;

  constructor(
    params: ConstructorParameters<typeof AegisError>[0] & {
      policyRuleViolated: string;
      spendRequestId?: string;
    },
  ) {
    super(params);
    this.policyRuleViolated = params.policyRuleViolated;
    this.spendRequestId = params.spendRequestId;
  }
}

export class RateLimitError extends AegisError {
  /** Segundos até a próxima tentativa ser permitida. */
  readonly retryAfterSeconds: number;

  constructor(
    params: ConstructorParameters<typeof AegisError>[0] & { retryAfterSeconds: number },
  ) {
    super(params);
    this.retryAfterSeconds = params.retryAfterSeconds;
  }
}

// ===== 5xx / network =====

export class StellarError extends AegisError {}

export class InternalError extends AegisError {}

/** Erro de rede/timeout antes mesmo da API responder. */
export class NetworkError extends AegisError {
  constructor(detail: string, cause?: unknown) {
    super({
      statusCode: 0,
      type: 'network-error',
      title: 'Network error',
      detail,
    });
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

// ===== Parser de problem+json =====

interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  [k: string]: unknown;
}

/**
 * Converte uma response HTTP de erro (4xx/5xx) em uma `AegisError` apropriada.
 * A API responde com `Content-Type: application/problem+json` (RFC 7807).
 */
export async function errorFromResponse(response: Response): Promise<AegisError> {
  let body: ProblemDetails;
  try {
    body = (await response.json()) as ProblemDetails;
  } catch {
    body = {
      type: 'unknown',
      title: response.statusText,
      status: response.status,
      detail: `Non-JSON error response (status ${response.status})`,
    };
  }

  const params = {
    statusCode: body.status ?? response.status,
    type: body.type ?? 'about:blank',
    title: body.title ?? 'Error',
    detail: body.detail ?? body.title ?? 'Unknown error',
    extras: stripStandardFields(body),
  };

  // Mapeia type-URI para subclasse específica
  if (body.type?.endsWith('/idempotency-key-conflict')) {
    return new IdempotencyConflictError({
      ...params,
      idempotencyKey: (body['idempotencyKey'] as string | undefined) ?? '<unknown>',
    });
  }
  if (body.type?.endsWith('/policy-rejected')) {
    return new PolicyRejectedError({
      ...params,
      policyRuleViolated:
        (body['policyRuleViolated'] as string | undefined) ?? 'unknown',
      spendRequestId: body['spendRequestId'] as string | undefined,
    });
  }
  if (body.type?.endsWith('/rate-limit-exceeded')) {
    const retryAfter = Number(body['retryAfterSeconds'] ?? response.headers.get('retry-after') ?? 60);
    return new RateLimitError({ ...params, retryAfterSeconds: retryAfter });
  }
  if (body.type?.endsWith('/validation-failed')) return new ValidationError(params);
  if (body.type?.endsWith('/unauthorized')) return new UnauthorizedError(params);
  if (body.type?.endsWith('/forbidden')) return new ForbiddenError(params);
  if (body.type?.endsWith('/not-found')) return new NotFoundError(params);
  if (body.type?.endsWith('/conflict')) return new ConflictError(params);
  if (body.type?.endsWith('/stellar-error')) return new StellarError(params);
  if (body.type?.endsWith('/internal-error')) return new InternalError(params);

  // Fallback por status code
  if (response.status === 401) return new UnauthorizedError(params);
  if (response.status === 403) return new ForbiddenError(params);
  if (response.status === 404) return new NotFoundError(params);
  if (response.status === 409) return new ConflictError(params);
  if (response.status === 422) {
    return new PolicyRejectedError({
      ...params,
      policyRuleViolated: 'unknown',
    });
  }
  if (response.status === 429) {
    return new RateLimitError({
      ...params,
      retryAfterSeconds: Number(response.headers.get('retry-after') ?? 60),
    });
  }
  if (response.status >= 500) return new InternalError(params);

  return new AegisError(params);
}

function stripStandardFields(body: ProblemDetails): Record<string, unknown> {
  const { type, title, status, detail, instance, ...rest } = body;
  void type;
  void title;
  void status;
  void detail;
  void instance;
  return rest;
}
