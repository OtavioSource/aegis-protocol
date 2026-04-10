import { api, COMPANY_ID } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { ApprovalActions } from './approval-actions';
import { CheckSquare } from 'lucide-react';

type ApprovalRequest = {
  id: string;
  status: string;
  createdAt: string;
  spendRequest: {
    id: string;
    vendor: string;
    amount: number;
    currency: string;
    reason: string;
    actionType: string;
    decisionReason: string | null;
    agent: { id: string; name: string; type: string };
  };
};

export default async function ApprovalsPage() {
  const pending = await api
    .get<ApprovalRequest[]>(`/approvals/pending?companyId=${COMPANY_ID}`)
    .catch(() => [] as ApprovalRequest[]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pending Approvals</h1>
        <p className="text-gray-500 mt-1">Spend requests requiring human review</p>
      </div>

      {pending.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <CheckSquare className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="font-medium">All clear — no pending approvals</p>
          <p className="text-sm mt-1">Spend requests below the approval threshold are auto-approved</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((appr) => (
            <div key={appr.id} className="bg-white border border-yellow-200 rounded-lg p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
                    <span className="text-xs font-medium text-yellow-700 uppercase tracking-wide">Awaiting Approval</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 text-lg">
                    {appr.spendRequest.vendor}
                  </h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {appr.spendRequest.agent.name} ({appr.spendRequest.agent.type}) ·{' '}
                    {appr.spendRequest.actionType}
                  </p>

                  <div className="mt-3 bg-gray-50 rounded-md p-3 text-sm">
                    <p className="font-medium text-gray-700">Reason from agent:</p>
                    <p className="text-gray-600 mt-0.5">{appr.spendRequest.reason}</p>
                  </div>

                  {appr.spendRequest.decisionReason && (
                    <div className="mt-2 text-xs text-amber-700 bg-amber-50 rounded p-2">
                      Policy: {appr.spendRequest.decisionReason}
                    </div>
                  )}

                  <p className="text-xs text-gray-400 mt-2">
                    Submitted {formatDate(appr.createdAt)}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-2xl font-bold text-gray-900">
                    {formatCurrency(appr.spendRequest.amount, appr.spendRequest.currency)}
                  </p>
                  <ApprovalActions approvalId={appr.id} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
