'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DollarSign, X } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Props = { agentId: string; companyId: string; hasBudget: boolean };

export function SetBudgetButton({ agentId, companyId, hasBudget }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-violet-300 text-violet-700 hover:bg-violet-50 transition-colors font-medium"
      >
        <DollarSign className="h-3.5 w-3.5" />
        {hasBudget ? 'Edit Budget' : 'Set Budget'}
      </button>
      {open && <SetBudgetModal agentId={agentId} companyId={companyId} onClose={() => setOpen(false)} />}
    </>
  );
}

function SetBudgetModal({
  agentId,
  companyId,
  onClose,
}: {
  agentId: string;
  companyId: string;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const body = {
      agentId,
      dailyLimit: Number(form.get('dailyLimit')),
      monthlyLimit: Number(form.get('monthlyLimit')),
      perTransactionLimit: Number(form.get('perTransactionLimit')),
      currency: 'USDC',
    };

    try {
      const res = await fetch(`${API}/companies/${companyId}/budgets`, {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-violet-600" />
            <h2 className="text-lg font-semibold text-gray-900">Set Budget Limits</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-gray-500">
            All amounts in USDC. Setting a new budget deactivates the previous one.
          </p>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Per Transaction Limit (USDC) <span className="text-red-500">*</span>
            </label>
            <input
              name="perTransactionLimit"
              type="number"
              required
              min="0"
              step="0.01"
              placeholder="e.g. 50"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="text-xs text-gray-400 mt-1">Maximum amount for any single transaction</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Daily Limit (USDC) <span className="text-red-500">*</span>
            </label>
            <input
              name="dailyLimit"
              type="number"
              required
              min="0"
              step="0.01"
              placeholder="e.g. 200"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="text-xs text-gray-400 mt-1">Total the agent can spend per calendar day</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Monthly Limit (USDC) <span className="text-red-500">*</span>
            </label>
            <input
              name="monthlyLimit"
              type="number"
              required
              min="0"
              step="0.01"
              placeholder="e.g. 2000"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="text-xs text-gray-400 mt-1">Total the agent can spend per calendar month</p>
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
              {loading ? 'Saving…' : 'Save Budget'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
