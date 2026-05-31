'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

/**
 * Linha da tabela de Audit com expansão (acordeon).
 * - Linha principal: Date, Event, Actor + chevron.
 * - Click: revela uma sub-row com o payload renderizado como tabela key/value.
 */
export function AuditRow({
  date,
  eventBadge,
  actorLabel,
  payload,
}: {
  date: string;
  eventBadge: React.ReactNode;
  actorLabel: string;
  payload: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(payload);

  return (
    <>
      <tr
        className="cursor-pointer border-t border-ink-700 hover:bg-ink-800/50"
        onClick={() => setOpen((v) => !v)}
      >
        <td className="px-4 py-2.5 text-slate-300">
          <span className="inline-flex items-center gap-2">
            {open ? (
              <ChevronDown size={14} className="text-slate-500" aria-hidden="true" />
            ) : (
              <ChevronRight size={14} className="text-slate-500" aria-hidden="true" />
            )}
            {date}
          </span>
        </td>
        <td className="px-4 py-2.5 text-slate-300">{eventBadge}</td>
        <td className="px-4 py-2.5 text-slate-300">{actorLabel}</td>
      </tr>
      {open ? (
        <tr className="border-t border-ink-700 bg-ink-900/60">
          <td colSpan={3} className="px-4 py-3">
            {entries.length === 0 ? (
              <p className="text-xs text-slate-500">No payload.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="w-1/3 pb-2 font-medium uppercase tracking-wider">Field</th>
                    <th className="pb-2 font-medium uppercase tracking-wider">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([k, v]) => (
                    <tr key={k} className="border-t border-ink-800/60">
                      <td className="py-1.5 pr-3 align-top text-slate-400">{k}</td>
                      <td className="py-1.5 align-top text-slate-200">
                        <FieldValue field={k} value={v} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function FieldValue({ field, value }: { field: string; value: unknown }) {
  // null / undefined
  if (value === null || value === undefined) {
    return <span className="text-slate-500">—</span>;
  }

  // amounts in cents — render with $
  if (typeof value === 'number' && /Cents$/i.test(field)) {
    const formatted = (value / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return <span className="tabular-nums">${formatted}</span>;
  }

  // tx hashes / public keys — show as mono code
  if (
    typeof value === 'string' &&
    /(Hash|PublicKey|destinationPublicKey)$/i.test(field) &&
    value.length > 20
  ) {
    return <code className="break-all text-slate-300">{value}</code>;
  }

  // strings / numbers / booleans
  if (typeof value !== 'object') {
    return <span>{String(value)}</span>;
  }

  // objects / arrays — pretty JSON
  return (
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-ink-700 bg-ink-900 p-2 text-xs text-slate-300">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
