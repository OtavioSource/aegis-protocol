import {
  Badge,
  EmptyState,
  fmtCents,
  fmtDate,
  PageHeader,
  StatCard,
  StatusBadge,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui';
import { api } from '@/lib/api';
import type { Agent, Listed, SpendRequest, TreasuryBalances, Vendor } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const [treasury, spend, pending, vendors, agents] = await Promise.all([
    api.get<TreasuryBalances>('/v1/treasury/balances'),
    api.get<Listed<SpendRequest>>('/v1/spend-requests?limit=200'),
    api.get<Listed<SpendRequest>>('/v1/approvals/pending'),
    api.get<Listed<Vendor>>('/v1/vendors'),
    api.get<Listed<Agent>>('/v1/agents'),
  ]);

  const usdc = treasury.balances.find((b) => b.assetCode === 'USDC');
  const xlm = treasury.balances.find((b) => b.assetCode === 'XLM');
  const vendorName = new Map(vendors.data.map((v) => [v.id, v.name]));
  const recent = spend.data.slice(0, 8);

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Treasury ${treasury.treasuryPublicKey.slice(0, 8)}… · network ${treasury.network}`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Treasury USDC" value={usdc?.amount ?? '0'} />
        <StatCard label="Treasury XLM" value={xlm?.amount ?? '0'} />
        <StatCard
          label="Pending approvals"
          value={pending.data.length}
          hint="awaiting human decision"
        />
        <StatCard label="Spend requests" value={spend.data.length} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Vendors" value={vendors.data.length} />
        <StatCard label="Agents" value={agents.data.length} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-100">
        Recent spend requests
      </h2>
      {recent.length === 0 ? (
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
            </Tr>
          </THead>
          <tbody>
            {recent.map((sr) => (
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
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
