'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, ZapOff } from 'lucide-react';

type Props = { agentId: string; active: boolean };

export function KillSwitchButton({ agentId, active }: Props) {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function toggle() {
    if (!confirm(active ? 'Deactivate kill switch for this agent?' : '⚠️ Activate kill switch? All spend requests from this agent will be blocked.')) return;
    setLoading(true);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/agents/${agentId}/kill-switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activate: !active, reason: active ? 'Manual deactivation' : 'Manual kill switch' }),
      });
      startTransition(() => router.refresh());
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading || isPending}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active
          ? 'bg-red-600 text-white hover:bg-red-700'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      } disabled:opacity-50`}
    >
      {active ? <ZapOff className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
      {active ? 'Deactivate' : 'Kill Switch'}
    </button>
  );
}
