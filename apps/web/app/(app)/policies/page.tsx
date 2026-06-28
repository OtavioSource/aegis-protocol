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
import { createPolicy, togglePolicy } from '@/lib/actions';
import { api } from '@/lib/api';
import type { Listed, Policy, Vendor } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function PoliciesPage() {
  const [policies, vendors] = await Promise.all([
    api.get<Listed<Policy>>('/v1/policies?all=true'),
    api.get<Listed<Vendor>>('/v1/vendors'),
  ]);
  const vendorName = (id: string) =>
    vendors.data.find((v) => v.id === id)?.name ?? `${id.slice(0, 8)}…`;

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
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={
                  <span className="inline-flex items-center gap-1">
                    Max spend / hour ($)
                    <InfoTooltip text="Velocity cap: total spent in the last rolling hour. Exceeding escalates the spend request to human approval (it does not reject). Empty = no limit." />
                  </span>
                }
                hint="empty = no limit"
              >
                <Input
                  name="maxSpendPerHour"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="500.00"
                />
              </Field>
              <Field
                label={
                  <span className="inline-flex items-center gap-1">
                    Max payments / hour
                    <InfoTooltip text="Velocity cap: number of executed payments in the last rolling hour. Exceeding escalates to human approval. Empty = no limit." />
                  </span>
                }
                hint="empty = no limit"
              >
                <Input name="maxPaymentsPerHour" type="number" step="1" min="0" placeholder="100" />
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
            <Field
              label={
                <span className="inline-flex items-center gap-1">
                  Vendor access
                  <InfoTooltip text="Whitelist/blacklist de vendors. Allow vazio = todos liberados. Deny tem precedência sobre Allow (vendor marcado em Deny é sempre bloqueado)." />
                </span>
              }
              hint="allow vazio = todos · deny vence allow"
            >
              {vendors.data.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum vendor cadastrado ainda.</p>
              ) : (
                <div className="overflow-hidden rounded-md border border-slate-700/60">
                  <div className="grid grid-cols-[1fr_4rem_4rem] gap-2 border-b border-slate-800 bg-slate-900/40 px-3 py-1.5 text-xs text-slate-500">
                    <span>Vendor</span>
                    <span className="text-center text-emerald-400/80">Allow</span>
                    <span className="text-center text-red-400/80">Deny</span>
                  </div>
                  {vendors.data.map((v) => (
                    <div
                      key={v.id}
                      className="grid grid-cols-[1fr_4rem_4rem] items-center gap-2 px-3 py-1.5 text-sm odd:bg-slate-900/20"
                    >
                      <span className="truncate text-slate-300">
                        {v.name}
                        {v.category ? (
                          <span className="ml-1.5 text-xs text-slate-500">{v.category}</span>
                        ) : null}
                      </span>
                      <input
                        type="checkbox"
                        name="allowVendor"
                        value={v.id}
                        className="accent-accent justify-self-center"
                      />
                      <input
                        type="checkbox"
                        name="denyVendor"
                        value={v.id}
                        className="accent-accent justify-self-center"
                      />
                    </div>
                  ))}
                </div>
              )}
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
              <Th>Spend/hr</Th>
              <Th>Pmts/hr</Th>
              <Th>Action types</Th>
              <Th>Vendor ACL</Th>
              <Th>State</Th>
              <Th>Created</Th>
              <Th>Action</Th>
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
                <Td>{fmtCents(p.rules.maxSpendPerHourCents ?? null)}</Td>
                <Td>{p.rules.maxPaymentsPerHour ?? '—'}</Td>
                <Td>{p.rules.actionTypes.length > 0 ? p.rules.actionTypes.join(', ') : 'all'}</Td>
                <Td>
                  {p.rules.vendorAllowList.length === 0 && p.rules.vendorDenyList.length === 0 ? (
                    'all'
                  ) : (
                    <div className="flex flex-col gap-0.5 text-xs">
                      {p.rules.vendorAllowList.length > 0 && (
                        <span className="text-emerald-400">
                          ✓ {p.rules.vendorAllowList.map(vendorName).join(', ')}
                        </span>
                      )}
                      {p.rules.vendorDenyList.length > 0 && (
                        <span className="text-red-400">
                          ✕ {p.rules.vendorDenyList.map(vendorName).join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                </Td>
                <Td>
                  {p.isActive ? <Badge tone="green">active</Badge> : <Badge tone="gray">inactive</Badge>}
                </Td>
                <Td>{fmtDate(p.createdAt)}</Td>
                <Td>
                  <ActionForm
                    action={togglePolicy}
                    submitLabel={p.isActive ? 'Deactivate' : 'Activate'}
                    submitVariant={p.isActive ? 'danger' : 'subtle'}
                  >
                    <input type="hidden" name="policyId" value={p.id} />
                    <input type="hidden" name="isActive" value={p.isActive ? 'false' : 'true'} />
                  </ActionForm>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
