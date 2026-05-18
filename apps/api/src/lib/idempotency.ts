/**
 * Helpers de idempotência para POST /v1/spend-requests (RNF2).
 *
 * Estratégia:
 * 1. Header `Idempotency-Key: <uuid>` obrigatório.
 * 2. Antes de criar SpendRequest, busca por (companyId, idempotencyKey).
 * 3. Se existe: compara hash do body normalizado com o snapshot armazenado.
 *    - Match → retorna SpendRequest existente sem reprocessar (200).
 *    - Mismatch → 409 IdempotencyConflictError.
 * 4. Se não existe: insere com unique constraint (race-safe — duas requests
 *    concorrentes com mesma key → uma vence, outra recebe Prisma P2002 e
 *    refaz lookup).
 *
 * Hash do body: SHA-256 sobre JSON canônico (chaves ordenadas).
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { IdempotencyConflictError, ValidationError } from './errors.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IdempotencyKeySchema = z
  .string()
  .regex(UUID_REGEX, 'Idempotency-Key must be a UUID');

export function extractIdempotencyKey(headerValue: string | undefined): string {
  if (!headerValue) {
    throw new ValidationError('Header Idempotency-Key is required for this endpoint');
  }
  const parsed = IdempotencyKeySchema.safeParse(headerValue);
  if (!parsed.success) {
    throw new ValidationError('Header Idempotency-Key must be a valid UUID');
  }
  return parsed.data;
}

/** Stringify canônico (chaves ordenadas recursivamente). */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

/**
 * Compara hash do body novo com o snapshot do body antigo (extraído do
 * `metadata.__idempotencyBodyHash` na SpendRequest persistida).
 *
 * Lança IdempotencyConflictError se diferentes.
 */
export function assertSameBody(
  idempotencyKey: string,
  newBodyHash: string,
  storedBodyHash: string | undefined,
): void {
  if (storedBodyHash && storedBodyHash !== newBodyHash) {
    throw new IdempotencyConflictError(idempotencyKey);
  }
}
