import { ArrowUpRight, Bot, Building2, Clock, DollarSign, Globe, Receipt } from 'lucide-react';

import {
  EmptyState,
  fmtCents,
  fmtDate,
  PageHeader,
  SectionCard,
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
  const hasPending = pending.data.length > 0;

  return (
    <>
      <PageHeader
        title="Visão geral"
        description={`Tesouro ${treasury.treasuryPublicKey.slice(0, 8)}… · ${treasury.network}`}
      />

      <div className="space-y-4">
        {/* Treasury balances */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-600">
            Balanços do Tesouro
          </p>
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              label="USDC"
              value={usdc?.amount ?? '0'}
              icon={<DollarSign size={15} />}
              valueClassName="text-accent"
            />
            <StatCard
              label="XLM"
              value={xlm?.amount ?? '0'}
              icon={<Globe size={15} />}
              valueClassName="text-accent"
            />
          </div>
        </div>

        {/* Activity metrics */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-600">
            Atividade
          </p>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Aprovações pendentes"
              value={pending.data.length}
              hint="aguardando decisão humana"
              icon={<Clock size={15} />}
              valueClassName={hasPending ? 'text-amber-300' : 'text-slate-100'}
            />
            <StatCard
              label="Spend requests"
              value={spend.data.length}
              icon={<Receipt size={15} />}
            />
            <StatCard
              label="Vendors"
              value={vendors.data.length}
              icon={<Building2 size={15} />}
            />
            <StatCard
              label="Agentes"
              value={agents.data.length}
              icon={<Bot size={15} />}
            />
          </div>
        </div>
      </div>

      {/* Recent spend requests */}
      <div className="mt-6">
        <SectionCard
          title="Spend requests recentes"
          noPadding
          action={
            <a
              href="/spend-requests"
              className="inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-accent"
            >
              Ver todos <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          }
        >
          {recent.length === 0 ? (
            <div className="p-5">
              <EmptyState>Nenhuma spend request ainda.</EmptyState>
            </div>
          ) : (
            <Table flush>
              <THead>
                <Tr>
                  <Th>Data</Th>
                  <Th>Ação</Th>
                  <Th>Vendor</Th>
                  <Th>Valor</Th>
                  <Th>Status</Th>
                </Tr>
              </THead>
              <tbody>
                {recent.map((sr) => (
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
                    <Td>
                      <StatusBadge status={sr.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </SectionCard>
      </div>
    </>
  );
}
