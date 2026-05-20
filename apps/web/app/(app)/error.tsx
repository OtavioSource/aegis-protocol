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
      <h2 className="text-sm font-semibold text-rose-300">Falha ao carregar</h2>
      <p className="mt-1 text-sm text-slate-400">{error.message}</p>
      <p className="mt-2 text-xs text-slate-500">
        Verifique se a API está rodando (porta 4000) e se AEGIS_API_KEY no
        apps/web/.env.local corresponde a uma chave de Agent válida.
      </p>
      <div className="mt-4">
        <Button variant="subtle" onClick={reset}>
          Tentar de novo
        </Button>
      </div>
    </Card>
  );
}
