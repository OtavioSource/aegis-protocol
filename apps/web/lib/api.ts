/**
 * Cliente HTTP server-side da Aegis API.
 *
 * Roda apenas no servidor (server components / server actions). Autentica na
 * API com o **session token do usuário logado**, lido do JWT do NextAuth (cookie
 * httpOnly criptografado) via `getToken` — server-only, nunca chega ao browser.
 *
 * Substitui a antiga `AEGIS_API_KEY` estática (key de Agent): aquela exigia
 * redeploy no Vercel a cada rotação de key. Agora a auth do dashboard acompanha
 * a sessão do humano e é independente do ciclo de vida das keys de agente.
 */

import 'server-only';

import { cookies } from 'next/headers';
import { decode } from 'next-auth/jwt';

const API_URL = process.env.AEGIS_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Recupera o session token da Aegis API guardado no JWT do NextAuth.
 * Server-only: lê o cookie httpOnly e decifra via `getToken` (NEXTAUTH_SECRET).
 */
async function getBearer(): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new ApiError('NEXTAUTH_SECRET not configured', 500);

  // Nome do cookie do NextAuth: `__Secure-` prefix em https.
  const secure = (process.env.NEXTAUTH_URL ?? '').startsWith('https://');
  const cookieName = secure
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token';

  const raw = cookies().get(cookieName)?.value;
  const token = raw ? await decode({ token: raw, secret }) : null;
  const sessionToken = token?.sessionToken;
  if (!sessionToken) {
    throw new ApiError('Not authenticated (no session token)', 401);
  }
  return sessionToken;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const bearer = await getBearer();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  const text = await res.text();
  if (!res.ok) {
    let detail = text || `API ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { detail?: string; title?: string };
      detail = parsed.detail ?? parsed.title ?? detail;
    } catch {
      /* não-JSON */
    }
    throw new ApiError(detail, res.status);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>('POST', path, body, headers),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
