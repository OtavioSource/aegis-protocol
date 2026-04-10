'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function ApprovalActions({ approvalId }: { approvalId: string }) {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function decide(action: 'approve' | 'reject') {
    const reason = action === 'reject'
      ? prompt('Rejection reason (optional):') ?? ''
      : undefined;
    setLoading(action);
    try {
      await fetch(`${API}/approvals/${approvalId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisionReason: reason }),
      });
      startTransition(() => router.refresh());
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex gap-2 mt-3">
      <button
        onClick={() => decide('approve')}
        disabled={!!loading || isPending}
        className="flex items-center gap-1.5 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
      >
        <Check className="h-4 w-4" />
        {loading === 'approve' ? 'Approving…' : 'Approve'}
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
