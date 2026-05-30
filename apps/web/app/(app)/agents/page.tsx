import { ActionForm } from '@/components/action-form';
import {
  EmptyState,
  Field,
  fmtDate,
  Input,
  PageHeader,
  SectionCard,
  Select,
  StatusBadge,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui';
import { createAgent } from '@/lib/actions';
import { api } from '@/lib/api';
import type { Agent, Listed, Policy } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const [agents, policies] = await Promise.all([
    api.get<Listed<Agent>>('/v1/agents'),
    api.get<Listed<Policy>>('/v1/policies'),
  ]);
  const policyName = new Map(policies.data.map((p) => [p.id, `${p.name} v${p.version}`]));

  return (
    <>
      <PageHeader
        title="Agents"
        description="AI identities that submit spend requests. Each agent has a cr_ API key."
      />

      <div className="mb-6">
        <SectionCard title="New agent">
          <ActionForm action={createAgent} submitLabel="Create agent">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <Input name="name" required placeholder="Customer Success Bot" />
              </Field>
              <Field label="Active policy">
                <Select name="activePolicyId" required>
                  <option value="">Select…</option>
                  {policies.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} v{p.version}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Description (optional)">
              <Input name="description" placeholder="Agent for tier-1 automation" />
            </Field>
          </ActionForm>
        </SectionCard>
      </div>

      {agents.data.length === 0 ? (
        <EmptyState>No agents registered.</EmptyState>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>API key</Th>
              <Th>Policy</Th>
              <Th>Status</Th>
              <Th>Created</Th>
            </Tr>
          </THead>
          <tbody>
            {agents.data.map((a) => (
              <Tr key={a.id}>
                <Td>{a.name}</Td>
                <Td>
                  <code className="text-xs text-slate-400">{a.apiKeyPrefix}…</code>
                </Td>
                <Td>{policyName.get(a.activePolicyId) ?? a.activePolicyId}</Td>
                <Td>
                  <StatusBadge status={a.status} />
                </Td>
                <Td>{fmtDate(a.createdAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
