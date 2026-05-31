'use client';

import { Info } from 'lucide-react';
import { useState } from 'react';

/**
 * Tooltip de ajuda inline. Click ou hover no ícone "i" abre uma caixa com texto
 * explicativo. Usado pra termos técnicos (CAP-33, action types, etc.) sem
 * poluir labels visíveis na UI.
 */
export function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="text-slate-500 transition-colors hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        aria-label="More info"
      >
        <Info size={13} aria-hidden="true" />
      </button>
      {open ? (
        <span
          role="tooltip"
          className="absolute left-1/2 top-full z-20 mt-1.5 w-64 -translate-x-1/2 whitespace-normal rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-xs leading-relaxed text-slate-300 shadow-xl"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
