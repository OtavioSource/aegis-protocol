/**
 * Cliente HTTP server-side da Aegis API.
 *
 * Roda apenas no servidor (server components / server actions): usa a
 * AEGIS_API_KEY (chave cr_ de Agent) que NUNCA chega ao browser. O dashboard
 * autentica o humano via NextAuth; estas chamadas falam com a API em nome
 * da Company usando a chave de serviço.
 */

import 'server-only';

const API_URL = process.env.AEGIS_API_URL ?? 'http://localhost:4000';
const API_KEY = process.env.AEGIS_API_KEY ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
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
