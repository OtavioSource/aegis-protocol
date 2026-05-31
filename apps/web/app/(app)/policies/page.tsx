import { ActionForm } from '@/components/action-form';
import { InfoTooltip } from '@/components/info-tooltip';
import {
  Badge,
  EmptyState,
  Field,
  fmtCents,
  fmtDate,
  Input,
  PageHeader,
  SectionCard,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui';
import { createPolicy } from '@/lib/actions';
import { api } from '@/lib/api';
import type { Listed, Policy } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function PoliciesPage() {
  const policies = await api.get<Listed<Policy>>('/v1/policies?all=true');

  return (
    <>
      <PageHeader
        title="Policies"
        description="Deterministic rules evaluated by the policy engine. Null limits = no limit."
      />

      <div className="mb-6">
        <SectionCard title="New policy">
          <ActionForm action={createPolicy} submitLabel="Create policy">
            <Field label="Name">
              <Input name="name" required placeholder="Conservative Policy" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Max per transaction ($)" hint="empty = no limit">
                <Input
                  name="maxPerTransaction"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="500.00"
                />
              </Field>
              <Field label="Monthly budget ($)" hint="empty = no limit">
                <Input
                  name="monthlyBudget"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="50000.00"
                />
              </Field>
              <Field label="Approval threshold ($)" hint="above → human approval">
                <Input
                  name="humanApprovalThreshold"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="100.00"
                />
              </Field>
            </div>
            <Field
              label={
                <span className="inline-flex items-center gap-1">
                  Allowed action types
                  <InfoTooltip text="Labels declared by agents when submitting a spend request (e.g. api-call, compute, scraping). The policy only allows spend requests whose action type is in this list. Leave empty to allow any." />
                </span>
              }
              hint="comma-separated; empty = all"
            >
              <Input name="actionTypes" placeholder="api-call, compute, scraping" />
            </Field>
          </ActionForm>
        </SectionCard>
      </div>

      {policies.data.length === 0 ? (
        <EmptyState>No policies registered.</EmptyState>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Version</Th>
              <Th>Max/tx</Th>
              <Th>Monthly budget</Th>
              <Th>Approval ≥</Th>
              <Th>Action types</Th>
              <Th>State</Th>
              <Th>Created</Th>
            </Tr>
          </THead>
          <tbody>
            {policies.data.map((p) => (
              <Tr key={p.id}>
                <Td>{p.name}</Td>
                <Td>v{p.version}</Td>
                <Td>{fmtCents(p.rules.maxPerTransactionCents)}</Td>
                <Td>{fmtCents(p.rules.monthlyBudgetCents)}</Td>
                <Td>{fmtCents(p.rules.humanApprovalThresholdCents)}</Td>
                <Td>{p.rules.actionTypes.length > 0 ? p.rules.actionTypes.join(', ') : 'all'}</Td>
                <Td>
                  {p.isActive ? <Badge tone="green">active</Badge> : <Badge tone="gray">inactive</Badge>}
                </Td>
                <Td>{fmtDate(p.createdAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
