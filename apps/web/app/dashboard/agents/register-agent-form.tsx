'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Plus, X, Copy, Check, AlertTriangle } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Treasury = { id: string; name: string; walletAddress: string };

type Props = {
  companyId: string;
  treasuries: Treasury[];
};

export function RegisterAgentButton({ companyId, treasuries }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Register Agent
      </button>
      {open && (
        <RegisterAgentModal
          companyId={companyId}
          treasuries={treasuries}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

type ModalProps = Props & { onClose: () => void };

function RegisterAgentModal({ companyId, treasuries, onClose }: ModalProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const agentTypes = [
    'marketing', 'devops', 'sales', 'finance', 'research',
    'procurement', 'support', 'analytics', 'custom',
  ];

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const body = {
      name: form.get('name') as string,
      type: form.get('type') as string,
      ownerName: form.get('ownerName') as string || undefined,
      ownerEmail: form.get('ownerEmail') as string || undefined,
      treasuryId: form.get('treasuryId') as string || undefined,
    };

    try {
      const res = await fetch(`${API}/companies/${companyId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Error ${res.status}`);
      }
      const agent = await res.json() as { apiKey: string };
      setCreatedKey(agent.apiKey);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }

  function copyKey() {
    if (!createdKey) return;
    navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-violet-600" />
            <h2 className="text-lg font-semibold text-gray-900">Register Agent</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* API Key reveal — shown after creation */}
        {createdKey ? (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Save this API key now</p>
                <p className="text-xs text-amber-700 mt-1">
                  This is the only time the key will be shown. It cannot be recovered.
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1 font-medium">API Key</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 block bg-gray-900 text-green-400 text-xs px-3 py-3 rounded-lg font-mono break-all">
                  {createdKey}
                </code>
                <button
                  onClick={copyKey}
                  className="flex items-center gap-1 px-3 py-3 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium transition-colors shrink-0"
                >
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Use this key as the <code className="bg-gray-100 px-1 rounded">Authorization: Bearer</code> header when the agent calls the CommandRail API.
            </p>
            <button
              onClick={onClose}
              className="w-full bg-violet-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-violet-700 transition-colors"
            >
              Done — I've saved the key
            </button>
          </div>
        ) : (
          /* Registration form */
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Agent Name <span className="text-red-500">*</span>
                </label>
                <input
                  name="name"
                  required
                  placeholder="e.g. Marketing Bot"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Type <span className="text-red-500">*</span>
                </label>
                <select
                  name="type"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {agentTypes.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Treasury</label>
                <select
                  name="treasuryId"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="">None</option>
                  {treasuries.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Owner Name</label>
                <input
                  name="ownerName"
                  placeholder="e.g. Growth Team"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Owner Email</label>
                <input
                  name="ownerEmail"
                  type="email"
                  placeholder="owner@company.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || isPending}
                className="flex-1 bg-violet-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Creating…' : 'Register Agent'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
