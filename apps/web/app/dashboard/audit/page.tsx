import { api, COMPANY_ID } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { ScrollText } from 'lucide-react';

type AuditLog = {
  id: string;
  eventType: string;
  actorType: string;
  actorId: string;
  createdAt: string;
  agent: { id: string; name: string } | null;
  spendRequest: { id: string; vendor: string; amount: number; currency: string } | null;
  payload: Record<string, unknown>;
};

const EVENT_COLORS: Record<string, string> = {
  SPEND_REQUEST_APPROVED: 'bg-green-100 text-green-700',
  SPEND_REQUEST_EXECUTED: 'bg-blue-100 text-blue-700',
  APPROVAL_GRANTED: 'bg-green-100 text-green-700',
  SPEND_REQUEST_REJECTED: 'bg-red-100 text-red-700',
  APPROVAL_DENIED: 'bg-red-100 text-red-700',
  KILL_SWITCH_ACTIVATED: 'bg-red-100 text-red-800 font-semibold',
  KILL_SWITCH_DEACTIVATED: 'bg-green-100 text-green-800',
  SPEND_REQUEST_REQUIRES_APPROVAL: 'bg-yellow-100 text-yellow-700',
  SPEND_REQUEST_SUBMITTED: 'bg-gray-100 text-gray-600',
  AGENT_REGISTERED: 'bg-violet-100 text-violet-700',
  TREASURY_CREATED: 'bg-violet-100 text-violet-700',
};

export default async function AuditPage() {
  const logs = await api
    .get<AuditLog[]>(`/companies/${COMPANY_ID}/audit-logs?limit=200`)
    .catch(() => [] as AuditLog[]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <p className="text-gray-500 mt-1">Immutable record of all governance events</p>
      </div>

      {logs.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <ScrollText className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>No audit events yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm divide-y divide-gray-100">
          {logs.map((log) => (
            <div key={log.id} className="px-5 py-3 hover:bg-gray-50">
              <div className="flex items-start gap-4">
                <div className="shrink-0 pt-0.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs ${EVENT_COLORS[log.eventType] ?? 'bg-gray-100 text-gray-600'}`}
                  >
                    {log.eventType.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {log.agent && (
                      <span className="text-sm font-medium text-gray-800">{log.agent.name}</span>
                    )}
                    {log.spendRequest && (
                      <span className="text-sm text-gray-600">
                        {log.spendRequest.vendor} — {log.spendRequest.amount} {log.spendRequest.currency}
                      </span>
                    )}
                    <span className="text-xs text-gray-400 ml-auto shrink-0">{formatDate(log.createdAt)}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {log.actorType} · {log.actorId}
                  </p>
                  {log.payload && Object.keys(log.payload).length > 0 && (
                    <details className="mt-1">
                      <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">payload</summary>
                      <pre className="text-xs text-gray-600 bg-gray-50 p-2 rounded mt-1 overflow-auto">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
