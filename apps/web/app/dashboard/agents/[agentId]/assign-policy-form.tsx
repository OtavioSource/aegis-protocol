'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, X, Plus, Trash2 } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Props = { agentId: string; hasPolicy: boolean };

export function AssignPolicyButton({ agentId, hasPolicy }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-violet-300 text-violet-700 hover:bg-violet-50 transition-colors font-medium"
      >
        <Shield className="h-3.5 w-3.5" />
        {hasPolicy ? 'Edit Policy' : 'Set Policy'}
      </button>
      {open && <AssignPolicyModal agentId={agentId} onClose={() => setOpen(false)} />}
    </>
  );
}

function AssignPolicyModal({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowList, setAllowList] = useState<string[]>([]);
  const [denyList, setDenyList] = useState<string[]>([]);
  const [actionTypes, setActionTypes] = useState<string[]>([]);
  const [newAllow, setNewAllow] = useState('');
  const [newDeny, setNewDeny] = useState('');
  const [newAction, setNewAction] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      name: form.get('name') as string,
      rules: {
        ...(form.get('requireApprovalAbove') ? { requireApprovalAbove: Number(form.get('requireApprovalAbove')) } : {}),
        ...(form.get('maxTransactionAmount') ? { maxTransactionAmount: Number(form.get('maxTransactionAmount')) } : {}),
        ...(allowList.length > 0 ? { vendorAllowList: allowList } : {}),
        ...(denyList.length > 0 ? { vendorDenyList: denyList } : {}),
        ...(actionTypes.length > 0 ? { allowedActionTypes: actionTypes } : {}),
      },
    };

    try {
      const res = await fetch(`${API}/agents/${agentId}/policies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? `Error ${res.status}`);
      }
      startTransition(() => router.refresh());
      onClose();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }

  function addToList(list: string[], setList: (v: string[]) => void, val: string, setVal: (v: string) => void) {
    const trimmed = val.trim();
    if (trimmed && !list.includes(trimmed)) setList([...list, trimmed]);
    setVal('');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-violet-600" />
            <h2 className="text-lg font-semibold text-gray-900">Assign Policy</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Policy Name <span className="text-red-500">*</span>
            </label>
            <input
              name="name"
              required
              placeholder="e.g. Standard Marketing Policy"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Approval Threshold (USDC)</label>
              <input
                name="requireApprovalAbove"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 10"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <p className="text-xs text-gray-400 mt-1">Requests above this amount require human approval</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Max per Transaction (USDC)</label>
              <input
                name="maxTransactionAmount"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 100"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <p className="text-xs text-gray-400 mt-1">Hard cap — requests above this are rejected</p>
            </div>
          </div>

          {/* Vendor allow list */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Vendor Allow List</label>
            <div className="flex gap-2 mb-2">
              <input
                value={newAllow}
                onChange={(e) => setNewAllow(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addToList(allowList, setAllowList, newAllow, setNewAllow); }}}
                placeholder="e.g. OpenAI"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <button type="button" onClick={() => addToList(allowList, setAllowList, newAllow, setNewAllow)} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {allowList.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {allowList.map((v) => (
                  <span key={v} className="flex items-center gap-1 bg-green-50 text-green-700 text-xs px-2 py-0.5 rounded">
                    {v}
                    <button type="button" onClick={() => setAllowList(allowList.filter((x) => x !== v))}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-1">If set, only these vendors are allowed. Leave empty to allow all.</p>
          </div>

          {/* Vendor deny list */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Vendor Deny List</label>
            <div className="flex gap-2 mb-2">
              <input
                value={newDeny}
                onChange={(e) => setNewDeny(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addToList(denyList, setDenyList, newDeny, setNewDeny); }}}
                placeholder="e.g. BlockedVendor"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <button type="button" onClick={() => addToList(denyList, setDenyList, newDeny, setNewDeny)} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {denyList.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {denyList.map((v) => (
                  <span key={v} className="flex items-center gap-1 bg-red-50 text-red-700 text-xs px-2 py-0.5 rounded">
                    {v}
                    <button type="button" onClick={() => setDenyList(denyList.filter((x) => x !== v))}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Allowed action types */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Allowed Action Types</label>
            <div className="flex gap-2 mb-2">
              <input
                value={newAction}
                onChange={(e) => setNewAction(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addToList(actionTypes, setActionTypes, newAction, setNewAction); }}}
                placeholder="e.g. purchase_api_access"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <button type="button" onClick={() => addToList(actionTypes, setActionTypes, newAction, setNewAction)} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {actionTypes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {actionTypes.map((v) => (
                  <span key={v} className="flex items-center gap-1 bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded font-mono">
                    {v}
                    <button type="button" onClick={() => setActionTypes(actionTypes.filter((x) => x !== v))}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-1">If set, only these action types are allowed. Leave empty to allow all.</p>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
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
              {loading ? 'Saving…' : 'Save Policy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
