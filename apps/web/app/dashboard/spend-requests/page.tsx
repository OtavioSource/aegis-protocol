import { api, COMPANY_ID } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatDate } from '@/lib/utils';
import { ExternalLink, CreditCard } from 'lucide-react';

type SpendRequest = {
  id: string;
  vendor: string;
  amount: number;
  currency: string;
  status: string;
  actionType: string;
  reason: string;
  decisionReason: string | null;
  matchedRule: string | null;
  txSignature: string | null;
  explorerUrl: string | null;
  createdAt: string;
  agent: { id: string; name: string; type: string };
  approvalRequest: { status: string } | null;
};

export default async function SpendRequestsPage() {
  const requests = await api
    .get<SpendRequest[]>(`/spend-requests?companyId=${COMPANY_ID}&limit=100`)
    .catch(() => [] as SpendRequest[]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Spend Requests</h1>
        <p className="text-gray-500 mt-1">All economic requests evaluated by the policy engine</p>
      </div>

      {requests.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>No spend requests yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Agent</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Vendor / Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Decision</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">On-chain</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {requests.map((req) => (
                <tr key={req.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">
                    <p className="font-medium text-gray-900">{req.agent.name}</p>
                    <p className="text-xs text-gray-400">{req.agent.type}</p>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <p className="font-medium text-gray-900">{req.vendor}</p>
                    <p className="text-xs text-gray-400">{req.actionType}</p>
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                    {formatCurrency(req.amount, req.currency)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px]">
                    <span className="truncate block" title={req.decisionReason ?? ''}>
                      {req.matchedRule ? `[${req.matchedRule}]` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge status={req.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{formatDate(req.createdAt)}</td>
                  <td className="px-4 py-3">
                    {req.explorerUrl ? (
                      <a
                        href={req.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Explorer
                      </a>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
