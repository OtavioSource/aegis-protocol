'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

/**
 * Render colapsável de payload JSON em uma linha de tabela.
 * - Estado padrão: prévia truncada inline.
 * - Click: expande mostrando JSON pretty-printed numa caixa abaixo.
 */
export function AuditPayload({ payload }: { payload: unknown }) {
  const [open, setOpen] = useState(false);
  const preview = JSON.stringify(payload);
  const pretty = JSON.stringify(payload, null, 2);

  return (
    <div className="max-w-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex w-full items-center gap-1 text-left text-xs text-slate-400 transition-colors hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={12} aria-hidden="true" />
        ) : (
          <ChevronRight size={12} aria-hidden="true" />
        )}
        <code className="truncate text-slate-500">{preview}</code>
      </button>
      {open ? (
        <pre className="mt-2 max-h-80 overflow-auto rounded-md border border-ink-700 bg-ink-900 p-3 text-xs text-slate-300">
          {pretty}
        </pre>
      ) : null}
    </div>
  );
}
