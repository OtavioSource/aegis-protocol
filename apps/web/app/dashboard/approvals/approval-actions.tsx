'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Zap } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Props = {
  approvalId: string;
  spendRequestId: string;
};

export function ApprovalActions({ approvalId, spendRequestId }: Props) {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [execStatus, setExecStatus] = useState<'idle' | 'executing' | 'done' | 'failed'>('idle');
  const [txUrl, setTxUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function decide(action: 'approve' | 'reject') {
    const reason =
      action === 'reject' ? prompt('Rejection reason (optional):') ?? '' : undefined;
    setLoading(action);
    try {
      const res = await fetch(`${API}/approvals/${approvalId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisionReason: reason }),
      });
      if (!res.ok) return;

      if (action === 'approve') {
        // Auto-execute the Solana transfer immediately after approval
        setExecStatus('executing');
        try {
          const execRes = await fetch(`${API}/spend-requests/${spendRequestId}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (execRes.ok) {
            const executed = await execRes.json() as { explorerUrl?: string };
            setTxUrl(executed.explorerUrl ?? null);
            setExecStatus('done');
          } else {
            setExecStatus('failed');
          }
        } catch {
          setExecStatus('failed');
        }
      }

      startTransition(() => router.refresh());
    } finally {
      setLoading(null);
    }
  }

  if (execStatus === 'done') {
    return (
      <div className="flex items-center gap-2 mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
        <Zap className="h-4 w-4 shrink-0" />
        <span>Approved & executed on Solana!</span>
        {txUrl && (
          <a href={txUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium ml-1">
            View TX →
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-2 mt-3">
      <button
        onClick={() => decide('approve')}
        disabled={!!loading || isPending}
        className="flex items-center gap-1.5 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
      >
        <Check className="h-4 w-4" />
        {loading === 'approve' || execStatus === 'executing'
          ? execStatus === 'executing' ? 'Executing…' : 'Approving…'
          : 'Approve & Execute'}
      </button>
      <button
        onClick={() => decide('reject')}
        disabled={!!loading || isPending}
        className="flex items-center gap-1.5 bg-white text-red-600 border border-red-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
      >
        <X className="h-4 w-4" />
        {loading === 'reject' ? 'Rejecting…' : 'Reject'}
      </button>
    </div>
  );
}
