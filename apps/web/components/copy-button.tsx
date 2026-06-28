'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** Botão de copiar para a área de transferência (id, pubkey, etc.). */
export function CopyButton({ value, title }: { value: string; title?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      title={title ?? 'Copiar'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard indisponível */
        }
      }}
      className="inline-flex items-center text-slate-500 transition-colors hover:text-accent focus-visible:outline-none focus-visible:text-accent"
      aria-label="Copiar"
    >
      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
    </button>
  );
}
