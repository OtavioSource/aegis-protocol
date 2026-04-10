import { Card, CardTitle, CardValue } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatDate } from '@/lib/utils';
import { api, COMPANY_ID } from '@/lib/api';
import { Bot, TrendingUp, Clock, AlertTriangle } from 'lucide-react';

type Agent = {
  id: string;
  name: string;
  type: string;
  status: string;
  killSwitchActive: boolean;
};

type SpendRequest = {
  id: string;
  vendor: string;
  amount: number;
  currency: string;
  status: string;
  policyDecision: string | null;
  createdAt: string;
  agent?: { name: string };
};

type ApprovalRequest = {
  id: string;
  status: string;
  spendRequest: SpendRequest & { agent: { name: string } };
};

async function getDashboardData(companyId: string) {
  const [agents, spendRequests, pending] = await Promise.all([
    api.get<Agent[]>(`/companies/${companyId}/agents`).catch(() => [] as Agent[]),
    api.get<SpendRequest[]>(`/spend-requests?companyId=${companyId}&limit=5`).catch(() => [] as SpendRequest[]),
    api.get<ApprovalRequest[]>(`/approvals/pending?companyId=${companyId}`).catch(() => [] as ApprovalRequest[]),
  ]);
  return { agents, spendRequests, pending };
}

export default async function DashboardPage() {
  const companyId = COMPANY_ID;

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-10 w-10 text-yellow-500 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">NEXT_PUBLIC_COMPANY_ID not configured</p>
          <p className="text-sm text-gray-400 mt-1">Set this env variable to your company ID</p>
        </div>
      </div>
    );
  }

  const { agents, spendRequests, pending } = await getDashboardData(companyId);

  const activeAgents = agents.filter((a) => a.status === 'ACTIVE' && !a.killSwitchActive).length;
  const killedAgents = agents.filter((a) => a.killSwitchActive).length;
  const totalSpent = spendRequests
    .filter((r) => r.status === 'EXECUTED')
    .reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
        <p className="text-gray-500 mt-1">Economic governance control plane for your AI agents</p>
      </div>

      {/* Kill switch alert */}
      {killedAgents > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
          <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">
              {killedAgents} agent{killedAgents > 1 ? 's' : ''} with kill switch active
            </p>
            <p className="text-xs text-red-600">All spend requests from those agents are blocked</p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardTitle>Active Agents</CardTitle>
          <CardValue>{activeAgents}</CardValue>
          <div className="flex items-center gap-1 mt-2">
            <Bot className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs text-gray-400">{agents.length} total registered</span>
          </div>
        </Card>
        <Card>
          <CardTitle>Pending Approvals</CardTitle>
          <CardValue>{pending.length}</CardValue>
          <div className="flex items-center gap-1 mt-2">
            <Clock className="h-3.5 w-3.5 text-yellow-500" />
            <span className="text-xs text-gray-400">awaiting human review</span>
          </div>
        </Card>
        <Card>
          <CardTitle>Recent Spend (executed)</CardTitle>
          <CardValue>{formatCurrency(totalSpent)}</CardValue>
          <div className="flex items-center gap-1 mt-2">
            <TrendingUp className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs text-gray-400">last {spendRequests.length} requests</span>
          </div>
        </Card>
        <Card>
          <CardTitle>Kill Switches</CardTitle>
          <CardValue className={killedAgents > 0 ? 'text-red-600' : ''}>{killedAgents}</CardValue>
          <div className="flex items-center gap-1 mt-2">
            <span className="text-xs text-gray-400">agents currently blocked</span>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">Recent Spend Requests</h2>
          {spendRequests.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No spend requests yet</p>
          ) : (
            <div className="space-y-3">
              {spendRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{req.vendor}</p>
                    <p className="text-xs text-gray-400">
                      {req.agent?.name ?? 'Unknown agent'} · {formatDate(req.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">
                      {formatCurrency(req.amount, req.currency)}
                    </p>
                    <Badge status={req.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Pending Approvals */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">Pending Approvals</h2>
          {pending.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No pending approvals</p>
          ) : (
            <div className="space-y-3">
              {pending.map((appr) => (
                <div key={appr.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{appr.spendRequest.vendor}</p>
                    <p className="text-xs text-gray-400">{appr.spendRequest.agent.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">
                      {formatCurrency(appr.spendRequest.amount, appr.spendRequest.currency)}
                    </p>
                    <Badge status="REQUIRES_APPROVAL" label="Needs review" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
