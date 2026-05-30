import { ExternalLink } from 'lucide-react';

import { ActionForm } from '@/components/action-form';
import {
  Badge,
  EmptyState,
  Field,
  fmtCents,
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
import { createSpendRequest } from '@/lib/actions';
import { api } from '@/lib/api';
import type { Listed, SpendRequest, Vendor } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SpendRequestsPage() {
  const [spend, vendors] = await Promise.all([
    api.get<Listed<SpendRequest>>('/v1/spend-requests?limit=200'),
    api.get<Listed<Vendor>>('/v1/vendors'),
  ]);
  const vendorName = new Map(vendors.data.map((v) => [v.id, v.name]));

  return (
    <>
      <PageHeader
        title="Spend Requests"
        description="Spend requests evaluated by the policy engine."
      />

      <div className="mb-6">
        <SectionCard title="New spend request">
          <ActionForm action={createSpendRequest} submitLabel="Create">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vendor">
                <Select name="vendorId" required>
                  <option value="">Select…</option>
                  {vendors.data.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Action type" hint="e.g. api-call, compute">
                <Input name="actionType" required placeholder="api-call" />
              </Field>
              <Field label="Amount (cents)" hint="100 = $1.00">
                <Input name="amountCents" type="number" min="1" required placeholder="100" />
              </Field>
              <Field label="Asset">
                <Input name="asset" defaultValue="USDC" />
              </Field>
            </div>
            <Field label="Reason (optional)">
              <Input name="reason" placeholder="Spend description" />
            </Field>
          </ActionForm>
        </SectionCard>
      </div>

      {spend.data.length === 0 ? (
        <EmptyState>No spend requests yet.</EmptyState>
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
              <Th>Tx</Th>
            </Tr>
          </THead>
          <tbody>
            {spend.data.map((sr) => (
              <Tr key={sr.id}>
                <Td>{fmtDate(sr.createdAt)}</Td>
                <Td>{sr.actionType}</Td>
                <Td>{sr.vendorId ? (vendorName.get(sr.vendorId) ?? '—') : '—'}</Td>
                <Td>
                  {fmtCents(sr.amountCents)} {sr.asset}
                </Td>
                <Td>{sr.decision ? <Badge tone="gray">{sr.decision}</Badge> : '—'}</Td>
                <Td>
                  <StatusBadge status={sr.status} />
                </Td>
                <Td>
                  {sr.stellarExpertUrl ? (
                    <a
                      href={sr.stellarExpertUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-accent transition-colors hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                      aria-label="View transaction on Stellar Expert (opens in a new tab)"
                    >
                      view <ExternalLink size={11} aria-hidden="true" />
                    </a>
                  ) : (
                    '—'
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
