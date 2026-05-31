import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import {
  Badge,
  EmptyState,
  fmtCents,
  fmtDate,
  PageHeader,
  SectionCard,
  StatusBadge,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { Agent, Listed, Policy, SpendRequest, Vendor } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let agent: Agent;
  try {
    agent = await api.get<Agent>(`/v1/agents/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return (
        <>
          <PageHeader title="Agent not found" />
          <EmptyState>
            <p>No agent with id {id}.</p>
            <Link href="/agents" className="mt-2 inline-block text-accent hover:underline">
              Back to agents
            </Link>
          </EmptyState>
        </>
      );
    }
    throw err;
  }

  const [spendList, vendors, policies] = await Promise.all([
    api.get<Listed<SpendRequest>>(`/v1/spend-requests?agentId=${id}&limit=200`),
    api.get<Listed<Vendor>>('/v1/vendors'),
    api.get<Listed<Policy>>('/v1/policies?all=true'),
  ]);

  const vendorName = new Map(vendors.data.map((v) => [v.id, v.name]));
  const policyLabel = new Map(policies.data.map((p) => [p.id, `${p.name} v${p.version}`]));

  const total = spendList.data.reduce((acc, sr) => acc + (sr.amountCents ?? 0), 0);
  const executed = spendList.data.filter((sr) => sr.status === 'EXECUTED').length;
  const requiresApproval = spendList.data.filter(
    (sr) => sr.status === 'REQUIRES_APPROVAL',
  ).length;
  const rejected = spendList.data.filter(
    (sr) => sr.status === 'REJECTED' || sr.status === 'REJECTED_BY_HUMAN',
  ).length;

  return (
    <>
      <Link
        href="/agents"
        className="mb-4 inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-slate-200"
      >
        <ArrowLeft size={12} aria-hidden="true" /> All agents
      </Link>

      <PageHeader
        title={agent.name}
        description={agent.description ?? 'No description.'}
      />

      <SectionCard title="Agent details">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500">API key prefix</dt>
            <dd className="mt-1">
              <code className="text-slate-300">{agent.apiKeyPrefix}…</code>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500">Active policy</dt>
            <dd className="mt-1 text-slate-300">
              {policyLabel.get(agent.activePolicyId) ?? agent.activePolicyId}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500">Status</dt>
            <dd className="mt-1">
              <StatusBadge status={agent.status} />
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500">Created</dt>
            <dd className="mt-1 text-slate-300">{fmtDate(agent.createdAt)}</dd>
          </div>
          {agent.revokedAt ? (
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">Revoked</dt>
              <dd className="mt-1 text-slate-300">{fmtDate(agent.revokedAt)}</dd>
            </div>
          ) : null}
        </dl>
      </SectionCard>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-100">Spend summary</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Total requested</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-100">
            {fmtCents(total)}
          </p>
        </div>
        <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Executed</p>
          <p className="mt-1 text-lg font-semibold text-emerald-300">{executed}</p>
        </div>
        <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Requires approval</p>
          <p className="mt-1 text-lg font-semibold text-amber-300">{requiresApproval}</p>
        </div>
        <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Rejected</p>
          <p className="mt-1 text-lg font-semibold text-rose-300">{rejected}</p>
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-100">Spend requests</h2>
      {spendList.data.length === 0 ? (
        <EmptyState>This agent has not submitted any spend requests yet.</EmptyState>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Date</Th>
              <Th>Action</Th>
              <Th>Vendor</Th>
              <Th>Amount</Th>
              <Th>Decision</Th>
              <Th>Status</Th>
            </Tr>
          </THead>
          <tbody>
            {spendList.data.map((sr) => (
              <Tr key={sr.id}>
                <Td>{fmtDate(sr.createdAt)}</Td>
                <Td>
                  <code className="text-xs text-slate-400">{sr.actionType}</code>
                </Td>
                <Td>{sr.vendorId ? (vendorName.get(sr.vendorId) ?? '—') : '—'}</Td>
                <Td>
                  <span className="tabular-nums">
                    {fmtCents(sr.amountCents)} {sr.asset}
                  </span>
                </Td>
                <Td>{sr.decision ? <Badge tone="gray">{sr.decision}</Badge> : '—'}</Td>
                <Td>
                  <StatusBadge status={sr.status} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
