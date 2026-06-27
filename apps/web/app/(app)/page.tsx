import { ArrowUpRight, Bot, Building2, Clock, DollarSign, Globe, Landmark, Receipt } from 'lucide-react';

import {
  EmptyState,
  fmtAssetAmount,
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
import type { Agent, Listed, SpendRequest, Vendor, Wallet } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const [wallets, spend, pending, vendors, agents] = await Promise.all([
    api.get<Listed<Wallet>>('/v1/wallets'),
    api.get<Listed<SpendRequest>>('/v1/spend-requests?limit=200'),
    api.get<Listed<SpendRequest>>('/v1/approvals/pending'),
    api.get<Listed<Vendor>>('/v1/vendors'),
    api.get<Listed<Agent>>('/v1/agents'),
  ]);

  // Soma os saldos on-chain das carteiras do usuário (não-custodial).
  const totalUsdc = wallets.data.reduce((s, w) => s + Number(w.balances?.usdc ?? 0), 0);
  const totalXlm = wallets.data.reduce((s, w) => s + Number(w.balances?.xlm ?? 0), 0);
  const vendorName = new Map(vendors.data.map((v) => [v.id, v.name]));
  const recent = spend.data.slice(0, 8);
  const hasPending = pending.data.length > 0;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Saldos das suas carteiras não-custodiais e atividade recente."
      />

      <div className="space-y-4">
        {/* Saldo agregado das carteiras do usuário */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-600">
            Saldo (suas carteiras)
          </p>
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              label="USDC"
              value={`$${fmtAssetAmount(totalUsdc, 'USDC')}`}
              hint={`${wallets.data.length} carteira(s)`}
              icon={<DollarSign size={15} />}
              valueClassName="text-accent"
              href="/wallets"
            />
            <StatCard
              label="XLM"
              value={fmtAssetAmount(totalXlm, 'XLM')}
              icon={<Globe size={15} />}
              valueClassName="text-accent"
              href="/wallets"
            />
          </div>
        </div>

        {/* Carteiras + saldos individuais */}
        <SectionCard
          title="Suas carteiras"
          noPadding
          action={
            <a
              href="/wallets"
              className="inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-accent"
            >
              Gerenciar <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          }
        >
          {wallets.data.length === 0 ? (
            <div className="p-5">
              <EmptyState>
                Nenhuma carteira ainda. Crie a primeira em <a className="text-accent" href="/wallets">Wallets</a>.
              </EmptyState>
            </div>
          ) : (
            <Table flush>
              <THead>
                <Tr>
                  <Th>Nome</Th>
                  <Th>Endereço</Th>
                  <Th>Status</Th>
                  <Th>USDC</Th>
                  <Th>XLM</Th>
                </Tr>
              </THead>
              <tbody>
                {wallets.data.map((w) => (
                  <Tr key={w.id}>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <Landmark size={13} className="text-slate-500" aria-hidden="true" />
                        {w.label}
                      </span>
                    </Td>
                    <Td>
                      <code className="text-xs text-slate-400">
                        {w.address.slice(0, 6)}…{w.address.slice(-4)}
                      </code>
                    </Td>
                    <Td>
                      <StatusBadge status={w.status} />
                    </Td>
                    <Td>
                      <span className="tabular-nums text-accent">
                        {w.balances ? `$${fmtAssetAmount(w.balances.usdc, 'USDC')}` : '—'}
                      </span>
                    </Td>
                    <Td>
                      <span className="tabular-nums text-slate-300">
                        {w.balances ? fmtAssetAmount(w.balances.xlm, 'XLM') : '—'}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </SectionCard>

        {/* Activity metrics */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-600">
            Activity
          </p>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Pending approvals"
              value={pending.data.length}
              hint="awaiting human decision"
              icon={<Clock size={15} />}
              valueClassName={hasPending ? 'text-amber-300' : 'text-slate-100'}
              href="/approvals"
            />
            <StatCard
              label="Spend requests"
              value={spend.data.length}
              icon={<Receipt size={15} />}
              href="/spend-requests"
            />
            <StatCard
              label="Vendors"
              value={vendors.data.length}
              icon={<Building2 size={15} />}
              href="/vendors"
            />
            <StatCard
              label="Agents"
              value={agents.data.length}
              icon={<Bot size={15} />}
              href="/agents"
            />
          </div>
        </div>
      </div>

      {/* Recent spend requests */}
      <div className="mt-6">
        <SectionCard
          title="Recent spend requests"
          noPadding
          action={
            <a
              href="/spend-requests"
              className="inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-accent"
            >
              View all <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          }
        >
          {recent.length === 0 ? (
            <div className="p-5">
              <EmptyState>No spend requests yet.</EmptyState>
            </div>
          ) : (
            <Table flush>
              <THead>
                <Tr>
                  <Th>Date</Th>
                  <Th>Action</Th>
                  <Th>Vendor</Th>
                  <Th>Amount</Th>
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
