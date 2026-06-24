import { ActionForm } from '@/components/action-form';
import { EmptyState, fmtAssetAmount, fmtDate, PageHeader, SectionCard, StatusBadge, Table, Td, Th, THead, Tr } from '@/components/ui';
import { WalletOnboarding } from '@/components/wallet-onboarding';
import { deleteWallet } from '@/lib/actions';
import { api } from '@/lib/api';
import type { Agent, Listed, Wallet } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function WalletsPage() {
  const [wallets, agents] = await Promise.all([
    api.get<Listed<Wallet>>('/v1/wallets'),
    api.get<Listed<Agent>>('/v1/agents'),
  ]);

  const agentsByWallet = new Map<string, string[]>();
  for (const a of agents.data) {
    if (a.walletId) {
      const arr = agentsByWallet.get(a.walletId) ?? [];
      arr.push(a.name);
      agentsByWallet.set(a.walletId, arr);
    }
  }

  return (
    <>
      <PageHeader
        title="Wallets"
        description="Carteiras não-custodiais (multisig). Você mantém a posse; o Aegis é co-signatário obrigatório dos pagamentos do agente."
      />

      <div className="mb-6">
        <SectionCard title="Nova carteira">
          <WalletOnboarding agents={agents.data} />
        </SectionCard>
      </div>

      {wallets.data.length === 0 ? (
        <EmptyState>Nenhuma carteira provisionada.</EmptyState>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Nome</Th>
              <Th>Endereço</Th>
              <Th>Origem</Th>
              <Th>Agentes</Th>
              <Th>Saldo</Th>
              <Th>Status</Th>
              <Th>Criada</Th>
              <Th>Ações</Th>
            </Tr>
          </THead>
          <tbody>
            {wallets.data.map((w) => (
              <Tr key={w.id}>
                <Td>{w.label}</Td>
                <Td>
                  <code className="text-xs text-slate-400">
                    {w.address.slice(0, 6)}…{w.address.slice(-4)}
                  </code>
                </Td>
                <Td>{w.ownerKeyMode === 'GENERATED' ? 'Aegis gerou' : 'Externa'}</Td>
                <Td>
                  <span className="text-xs text-slate-300">
                    {(agentsByWallet.get(w.id) ?? []).join(', ') || '—'}
                  </span>
                </Td>
                <Td>
                  {w.balances ? (
                    <span className="tabular-nums text-xs">
                      <span className="text-accent">${fmtAssetAmount(w.balances.usdc, 'USDC')}</span>
                      <span className="text-slate-500"> · {fmtAssetAmount(w.balances.xlm, 'XLM')} XLM</span>
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">—</span>
                  )}
                </Td>
                <Td>
                  <StatusBadge status={w.status} />
                </Td>
                <Td>{fmtDate(w.createdAt)}</Td>
                <Td>
                  {w.status === 'PROVISIONING' ? (
                    <ActionForm action={deleteWallet} submitLabel="Remover" submitVariant="danger">
                      <input type="hidden" name="walletId" value={w.id} />
                    </ActionForm>
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
