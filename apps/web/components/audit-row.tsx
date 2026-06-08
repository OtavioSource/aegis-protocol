'use client';

import { CheckCircle2, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useState } from 'react';

/**
 * Linha da tabela de Audit com expansão (acordeon).
 * - Linha principal: Date, Event, Actor + chevron + badge on-chain (se sorobanTxHash).
 * - Click: revela uma sub-row com o payload renderizado como tabela key/value.
 *   Se sorobanTxHash presente, exibe link "View on Stellar Expert" no topo.
 */
export function AuditRow({
  date,
  eventBadge,
  actorLabel,
  payload,
  sorobanTxHash,
  network = 'testnet',
}: {
  date: string;
  eventBadge: React.ReactNode;
  actorLabel: string;
  payload: Record<string, unknown>;
  sorobanTxHash?: string | null;
  network?: 'testnet' | 'mainnet';
}) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(payload);
  const explorerNetwork = network === 'mainnet' ? 'public' : 'testnet';
  const stellarExpertUrl = sorobanTxHash
    ? `https://stellar.expert/explorer/${explorerNetwork}/tx/${sorobanTxHash}`
    : null;

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
        <td className="px-4 py-2.5 text-slate-300">
          <span className="inline-flex items-center gap-2">
            {eventBadge}
            {sorobanTxHash ? (
              <span
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300"
                title="Recorded on Soroban (Stellar smart contract)"
              >
                <CheckCircle2 size={10} aria-hidden="true" />
                on-chain-test
              </span>
            ) : null}
          </span>
        </td>
        <td className="px-4 py-2.5 text-slate-300">{actorLabel}</td>
      </tr>
      {open ? (
        <tr className="border-t border-ink-700 bg-ink-900/60">
          <td colSpan={3} className="px-4 py-3">
            {stellarExpertUrl ? (
              <div className="mb-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
                <p className="text-xs font-medium text-emerald-300">On-chain proof</p>
                <p className="mt-1 text-xs text-slate-400">
                  This event was recorded on the Aegis Audit Soroban contract. The transaction
                  is publicly verifiable.
                </p>
                <a
                  href={stellarExpertUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-accent transition-colors hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  View on Stellar Expert
                  <ExternalLink size={11} aria-hidden="true" />
                </a>
                <code className="mt-1.5 block break-all text-[11px] text-slate-500">
                  {sorobanTxHash}
                </code>
              </div>
            ) : null}

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
