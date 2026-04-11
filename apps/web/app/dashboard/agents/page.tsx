import { api, COMPANY_ID } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { KillSwitchButton } from './kill-switch-button';
import { RegisterAgentButton } from './register-agent-form';
import Link from 'next/link';
import { Bot } from 'lucide-react';

type Policy = { id: string; name: string; rules: Record<string, unknown>; active: boolean };
type Budget = { dailyLimit: number; monthlyLimit: number; perTransactionLimit: number; currency: string };
type Treasury = { id: string; name: string; walletAddress: string };
type Agent = {
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
  _count: { spendRequests: number };
};

export default async function AgentsPage() {
  const [agents, treasuries] = await Promise.all([
    api.get<Agent[]>(`/companies/${COMPANY_ID}/agents`).catch(() => [] as Agent[]),
    api.get<Treasury[]>(`/companies/${COMPANY_ID}/treasuries`).catch(() => [] as Treasury[]),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agents</h1>
          <p className="text-gray-500 mt-1">Registered AI agents with economic autonomy</p>
        </div>
        <RegisterAgentButton companyId={COMPANY_ID} treasuries={treasuries} />
      </div>

      {agents.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Bot className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>No agents registered yet</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {agents.map((agent) => {
            const budget = agent.budgets[0];
            const policy = agent.policies[0];
            return (
              <div
                key={agent.id}
                className={`bg-white rounded-lg border p-5 shadow-sm ${agent.killSwitchActive ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-lg ${agent.killSwitchActive ? 'bg-red-100' : 'bg-violet-100'}`}>
                      <Bot className={`h-5 w-5 ${agent.killSwitchActive ? 'text-red-600' : 'text-violet-600'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Link href={`/dashboard/agents/${agent.id}`} className="font-semibold text-gray-900 hover:text-violet-600">
                          {agent.name}
                        </Link>
                        <Badge status={agent.killSwitchActive ? 'FROZEN' : agent.status} label={agent.killSwitchActive ? 'KILL SWITCH' : agent.status} />
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{agent.type} · {agent.ownerName ?? 'No owner'} · {agent._count.spendRequests} requests</p>
                      {policy && (
                        <p className="text-xs text-gray-500 mt-1">Policy: {policy.name}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {budget && (
                      <div className="text-right text-xs text-gray-500">
                        <p>Daily: {budget.dailyLimit} {budget.currency}</p>
                        <p>Monthly: {budget.monthlyLimit} {budget.currency}</p>
                      </div>
                    )}
                    <KillSwitchButton
                      agentId={agent.id}
                      active={agent.killSwitchActive}
                    />
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-400">
                  <span>ID: {agent.id.slice(0, 12)}...</span>
                  <span>Registered: {formatDate(agent.createdAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
