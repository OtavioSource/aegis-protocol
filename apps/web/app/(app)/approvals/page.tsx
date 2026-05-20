import { ActionForm } from '@/components/action-form';
import { Card, EmptyState, fmtCents, fmtDate, PageHeader } from '@/components/ui';
import { approveSpend } from '@/lib/actions';
import { api } from '@/lib/api';
import type { Listed, SpendRequest, Vendor } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const [pending, vendors] = await Promise.all([
    api.get<Listed<SpendRequest>>('/v1/approvals/pending'),
    api.get<Listed<Vendor>>('/v1/vendors'),
  ]);
  const vendorName = new Map(vendors.data.map((v) => [v.id, v.name]));

  return (
    <>
      <PageHeader
        title="Aprovações"
        description="Spend requests escaladas para decisão humana (RF7). Aprovar dispara o pagamento on-chain."
      />

      {pending.data.length === 0 ? (
        <EmptyState>Nenhuma aprovação pendente.</EmptyState>
      ) : (
        <div className="space-y-4">
          {pending.data.map((sr) => (
            <Card key={sr.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-100">
                    {fmtCents(sr.amountCents)} {sr.asset} · {sr.actionType}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {sr.vendorId ? (vendorName.get(sr.vendorId) ?? sr.vendorId) : '—'} ·{' '}
                    {fmtDate(sr.createdAt)}
                  </p>
                  {sr.reason ? (
                    <p className="mt-1 text-sm text-slate-400">{sr.reason}</p>
                  ) : null}
                  {sr.decisionReason ? (
                    <p className="mt-1 text-xs text-amber-300">
                      Motivo da escalada: {sr.decisionReason}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-3">
                  <ActionForm action={approveSpend} submitLabel="Aprovar e executar">
                    <input type="hidden" name="spendRequestId" value={sr.id} />
                    <input type="hidden" name="action" value="APPROVED" />
                  </ActionForm>
                  <ActionForm
                    action={approveSpend}
                    submitLabel="Rejeitar"
                    submitVariant="danger"
                  >
                    <input type="hidden" name="spendRequestId" value={sr.id} />
                    <input type="hidden" name="action" value="REJECTED" />
                  </ActionForm>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
