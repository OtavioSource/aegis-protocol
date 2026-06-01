import {
  Badge,
  EmptyState,
  fmtDate,
  PageHeader,
  Pagination,
  Table,
  Th,
  THead,
  Tr,
} from '@/components/ui';
import { AuditRow } from '@/components/audit-row';
import { api } from '@/lib/api';
import type { Agent, AuditEvent, Listed } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

function actorLabel(actor: string, agentName: Map<string, string>): string {
  if (actor.startsWith('agent:')) {
    return agentName.get(actor.slice(6)) ?? `Agent (${actor.slice(6, 14)}…)`;
  }
  if (actor.startsWith('user:')) return 'Human approver';
  if (actor === 'system') return 'System';
  return actor;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const [audit, agents] = await Promise.all([
    api.get<Listed<AuditEvent>>(`/v1/audit?limit=${PAGE_SIZE}&skip=${skip}`),
    api.get<Listed<Agent>>('/v1/agents'),
  ]);
  const agentName = new Map(agents.data.map((a) => [a.id, a.name]));

  return (
    <>
      <PageHeader
        title="Audit"
        description="Immutable trail of decisions and payments — recorded on Soroban. Click a row to inspect the payload."
      />

      {audit.data.length === 0 ? (
        <EmptyState>No audit events yet.</EmptyState>
      ) : (
        <>
          <Table>
            <THead>
              <Tr>
                <Th>Date</Th>
                <Th>Event</Th>
                <Th>Actor</Th>
              </Tr>
            </THead>
            <tbody>
              {audit.data.map((e) => (
                <AuditRow
                  key={e.id}
                  date={fmtDate(e.createdAt)}
                  eventBadge={<Badge tone="blue">{e.eventType}</Badge>}
                  actorLabel={actorLabel(e.actor, agentName)}
                  payload={e.payload}
                  sorobanTxHash={e.sorobanTxHash}
                />
              ))}
            </tbody>
          </Table>

          <Pagination
            page={page}
            total={audit.total ?? audit.data.length}
            pageSize={PAGE_SIZE}
            basePath="/audit"
          />
        </>
      )}
    </>
  );
}
