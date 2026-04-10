const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
};

// ─── API helpers ─────────────────────────────────────────────────────────────

export const COMPANY_ID = process.env.NEXT_PUBLIC_COMPANY_ID ?? '';

export function getAgents(companyId: string) {
  return api.get(`/companies/${companyId}/agents`);
}

export function getAgent(agentId: string) {
  return api.get(`/agents/${agentId}`);
}

export function getSpendRequests(companyId: string, status?: string) {
  const qs = status ? `&status=${status}` : '';
  return api.get(`/spend-requests?companyId=${companyId}${qs}`);
}

export function getPendingApprovals(companyId: string) {
  return api.get(`/approvals/pending?companyId=${companyId}`);
}

export function getAuditLogs(companyId: string, agentId?: string) {
  const qs = agentId ? `&agentId=${agentId}` : '';
  return api.get(`/companies/${companyId}/audit-logs?${qs}`);
}

export function getTreasuries(companyId: string) {
  return api.get(`/companies/${companyId}/treasuries`);
}
