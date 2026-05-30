'use client';

import { Button, Card } from '@/components/ui';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card className="border-rose-500/30">
      <h2 className="text-sm font-semibold text-rose-300">Failed to load</h2>
      <p className="mt-1 text-sm text-slate-400">{error.message}</p>
      <p className="mt-2 text-xs text-slate-500">
        Check that the API is running (port 4000) and that AEGIS_API_KEY in
        apps/web/.env.local matches a valid Agent key.
      </p>
      <div className="mt-4">
        <Button variant="subtle" onClick={reset}>
          Try again
        </Button>
      </div>
    </Card>
  );
}
