import { api, COMPANY_ID } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle, CardValue } from '@/components/ui/card';
import { formatCurrency, formatDate } from '@/lib/utils';
import { KillSwitchButton } from '../kill-switch-button';
import { AssignPolicyButton } from './assign-policy-form';
import { SetBudgetButton } from './set-budget-form';
import { Bot, ArrowLeft, ExternalLink, Shield, DollarSign, Clock } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

type Policy = {
  id: string;
  name: string;
  active: boolean;
  rules: {
    maxTransactionAmount?: number;
    requireApprovalAbove?: number;
    vendorAllowList?: string[];
    vendorDenyList?: string[];
    allowedActionTypes?: string[];
    dailyLimit?: number;
    monthlyLimit?: number;
  };
};

type Budget = {
  id: string;
  dailyLimit: number;
  monthlyLimit: number;
  perTransactionLimit: number;
  currency: string;
};

type SpendRequest = {
  id: string;
  vendor: string;
  amount: number;
  currency: string;
  status: string;
  policyDecision: string | null;
  actionType: string;
  txSignature: string | null;
  explorerUrl: string | null;
  createdAt: string;
};

type AgentDetail = {
  id: string;
  name: string;
  type: string;
  status: string;
  killSwitchActive: boolean;
  ownerName: string | null;
  ownerEmail: string | null;
  createdAt: string;
  policies: Policy[];
  budgets: Budget[];
  spendRequests: SpendRequest[];
  _count: { spendRequests: number };
};

export default async function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;

  const agent = await api.get<AgentDetail>(`/agents/${agentId}`).catch(() => null);
  if (!agent) notFound();

  const policy = agent.policies[0];
  const budget = agent.budgets[0];
  const requests = agent.spendRequests ?? [];

  const executed = requests.filter((r) => r.status === 'EXECUTED');
  const rejected = requests.filter((r) => r.status === 'REJECTED');
  const pending = requests.filter((r) => r.status === 'REQUIRES_APPROVAL');
  const totalSpent = executed.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link href="/dashboard/agents" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" />
        Back to agents
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-xl ${agent.killSwitchActive ? 'bg-red-100' : 'bg-violet-100'}`}>
            <Bot className={`h-6 w-6 ${agent.killSwitchActive ? 'text-red-600' : 'text-violet-600'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{agent.name}</h1>
              <Badge
                status={agent.killSwitchActive ? 'FROZEN' : agent.status}
                label={agent.killSwitchActive ? 'KILL SWITCH ACTIVE' : agent.status}
              />
            </div>
            <p className="text-gray-500 mt-1">
              {agent.type} · Owner: {agent.ownerName ?? 'unassigned'}{agent.ownerEmail ? ` (${agent.ownerEmail})` : ''}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              ID: {agent.id} · Registered {formatDate(agent.createdAt)}
            </p>
          </div>
        </div>
        <KillSwitchButton agentId={agent.id} active={agent.killSwitchActive} />
      </div>

      {/* Kill switch warning */}
      {agent.killSwitchActive && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
          <strong>Kill switch is active.</strong> All spend requests from this agent are blocked. Deactivate to restore access.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardTitle>Total Spent</CardTitle>
          <CardValue>{formatCurrency(totalSpent)}</CardValue>
          <p className="text-xs text-gray-400 mt-1">{executed.length} executed txs</p>
        </Card>
        <Card>
          <CardTitle>Rejected</CardTitle>
          <CardValue className="text-red-600">{rejected.length}</CardValue>
          <p className="text-xs text-gray-400 mt-1">by policy engine</p>
        </Card>
        <Card>
          <CardTitle>Pending Review</CardTitle>
          <CardValue className="text-yellow-600">{pending.length}</CardValue>
          <p className="text-xs text-gray-400 mt-1">awaiting approval</p>
        </Card>
        <Card>
          <CardTitle>Total Requests</CardTitle>
          <CardValue>{agent._count.spendRequests}</CardValue>
          <p className="text-xs text-gray-400 mt-1">all time</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Policy */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-violet-500" />
              <h2 className="font-semibold text-gray-900">Active Policy</h2>
            </div>
            <AssignPolicyButton agentId={agent.id} hasPolicy={!!policy} />
          </div>
          {policy ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium text-gray-700">{policy.name}</p>
              <div className="space-y-1.5 mt-3">
                {policy.rules.requireApprovalAbove !== undefined && (
                  <div className="flex justify-between text-gray-600">
                    <span>Approval threshold</span>
                    <span className="font-medium">{policy.rules.requireApprovalAbove} USDC</span>
                  </div>
                )}
                {policy.rules.maxTransactionAmount !== undefined && (
                  <div className="flex justify-between text-gray-600">
                    <span>Max per transaction</span>
                    <span className="font-medium">{policy.rules.maxTransactionAmount} USDC</span>
                  </div>
                )}
                {policy.rules.vendorAllowList && policy.rules.vendorAllowList.length > 0 && (
                  <div className="mt-2">
                    <p className="text-gray-500 text-xs mb-1">Allowed vendors</p>
                    <div className="flex flex-wrap gap-1">
                      {policy.rules.vendorAllowList.map((v) => (
                        <span key={v} className="bg-green-50 text-green-700 text-xs px-2 py-0.5 rounded">{v}</span>
                      ))}
                    </div>
                  </div>
                )}
                {policy.rules.vendorDenyList && policy.rules.vendorDenyList.length > 0 && (
                  <div className="mt-2">
                    <p className="text-gray-500 text-xs mb-1">Blocked vendors</p>
                    <div className="flex flex-wrap gap-1">
                      {policy.rules.vendorDenyList.map((v) => (
                        <span key={v} className="bg-red-50 text-red-700 text-xs px-2 py-0.5 rounded">{v}</span>
                      ))}
                    </div>
                  </div>
                )}
                {policy.rules.allowedActionTypes && (
                  <div className="mt-2">
                    <p className="text-gray-500 text-xs mb-1">Allowed actions</p>
                    <div className="flex flex-wrap gap-1">
                      {policy.rules.allowedActionTypes.map((a) => (
                        <span key={a} className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded font-mono">{a}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No policy assigned</p>
          )}
        </div>

        {/* Budget */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-violet-500" />
              <h2 className="font-semibold text-gray-900">Budget Limits</h2>
            </div>
            <SetBudgetButton agentId={agent.id} companyId={COMPANY_ID} hasBudget={!!budget} />
          </div>
          {budget ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                <span className="text-gray-600">Per transaction</span>
                <span className="font-semibold text-gray-900">{formatCurrency(budget.perTransactionLimit, budget.currency)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                <span className="text-gray-600">Daily limit</span>
                <span className="font-semibold text-gray-900">{formatCurrency(budget.dailyLimit, budget.currency)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Monthly limit</span>
                <span className="font-semibold text-gray-900">{formatCurrency(budget.monthlyLimit, budget.currency)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No budget configured</p>
          )}
        </div>
      </div>

      {/* Recent spend requests */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
          <Clock className="h-4 w-4 text-violet-500" />
          <h2 className="font-semibold text-gray-900">Recent Spend Requests</h2>
        </div>
        {requests.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No requests yet</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {requests.slice(0, 20).map((req) => (
              <div key={req.id} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-900">{req.vendor}</p>
                  <p className="text-xs text-gray-400 font-mono">{req.actionType} · {formatDate(req.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">{formatCurrency(req.amount, req.currency)}</span>
                  <Badge status={req.status} />
                  {req.explorerUrl && (
                    <a href={req.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-violet-600">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
