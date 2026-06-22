/**
 * Session token do dashboard (humano) — token compacto assinado por HMAC-SHA256.
 *
 * Formato: `<payloadBase64url>.<sigBase64url>` (estilo JWT sem header, suficiente
 * porque só a API emite e verifica — o web trata o token como opaco e apenas o
 * reencaminha). Assinado com `SESSION_JWT_SECRET`. Sem dependência externa.
 *
 * Desacopla a auth do dashboard das API keys de agente (`cr_…`): o web passa a
 * mandar `Authorization: Bearer <sessionToken>` derivado do login do User, então
 * rotação de key de agente não exige mais redeploy.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../env.js';

/** Claims do humano autenticado. */
export interface SessionClaims {
  /** User.id */
  sub: string;
  companyId: string;
  role: string;
  email: string;
}

export type VerifiedSession = SessionClaims & { exp: number };

const DEFAULT_TTL_SECONDS = 8 * 60 * 60; // 8h

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

/** Emite um token de sessão assinado para o User. Lança se o secret não estiver configurado. */
export function mintSessionToken(
  claims: SessionClaims,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  if (!env.SESSION_JWT_SECRET) {
    throw new Error('SESSION_JWT_SECRET not configured — required to mint session tokens');
  }
  const payload = { ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, env.SESSION_JWT_SECRET)}`;
}

/** Verifica assinatura + expiração. Retorna os claims ou `null` se inválido/expirado. */
export function verifySessionToken(token: string): VerifiedSession | null {
  if (!env.SESSION_JWT_SECRET) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(body, env.SESSION_JWT_SECRET);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as VerifiedSession;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (!payload.sub || !payload.companyId) return null;
    return payload;
  } catch {
    return null;
  }
}
