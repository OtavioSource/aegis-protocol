/**
 * Primitivos de UI do dashboard — Tailwind puro, sem dependências externas.
 * Todos são presentacionais (sem hooks) → seguros em server e client components.
 */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- layout ----

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-ink-700 bg-ink-850 p-5', className)}>
      {children}
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
  noPadding,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  noPadding?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
      <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {action}
      </div>
      <div className={noPadding ? '' : 'p-5'}>{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
        {icon ? (
          <span className="text-slate-600" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>
      <p className={cn('mt-3 text-2xl font-semibold tabular-nums', valueClassName ?? 'text-slate-100')}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </Card>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-slate-400">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-ink-600 px-4 py-12 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

// ----------------------------------------------------------------- badge ----

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray';

const TONE_CLASS: Record<Tone, string> = {
  green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  red: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  blue: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  gray: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Mapeia status de domínio (uppercase) para uma tonalidade de badge. */
export function toneForStatus(status: string): Tone {
  const s = status.toUpperCase();
  if (['EXECUTED', 'COMPLETED', 'APPROVED', 'APPROVED_BY_HUMAN', 'ACTIVE'].includes(s)) {
    return 'green';
  }
  if (
    ['REJECTED', 'REJECTED_BY_HUMAN', 'FAILED', 'REVOKED', 'SUSPENDED'].includes(s)
  ) {
    return 'red';
  }
  if (
    ['REQUIRES_APPROVAL', 'PENDING_USER_TRANSFER', 'PENDING_USER_INFO', 'PROCESSING', 'INITIATED'].includes(
      s,
    )
  ) {
    return 'amber';
  }
  if (['REFUNDED'].includes(s)) return 'blue';
  return 'gray';
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={toneForStatus(status)}>{status}</Badge>;
}

// ---------------------------------------------------------------- button ----

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'subtle';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent/85',
  subtle: 'bg-ink-700 text-slate-100 hover:bg-ink-600',
  ghost: 'border border-ink-600 text-slate-200 hover:bg-ink-800',
  danger: 'bg-rose-600/90 text-white hover:bg-rose-600',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors min-h-[44px]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-1 focus-visible:ring-offset-ink-950',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}

// ------------------------------------------------------------------ table ----

export function Table({
  children,
  flush,
}: {
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <div className={cn('overflow-x-auto', flush ? '' : 'rounded-lg border border-ink-700')}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-ink-800 text-xs uppercase tracking-wide text-slate-500">
      {children}
    </thead>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return <th className="px-4 py-2.5 font-medium">{children}</th>;
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="border-t border-ink-700 transition-colors hover:bg-ink-800/60">{children}</tr>;
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('px-4 py-2.5 text-slate-300', className)}>{children}</td>;
}

// ------------------------------------------------------------------ forms ----

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

const FIELD_CLASS =
  'w-full min-h-[44px] rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(FIELD_CLASS, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(FIELD_CLASS, 'min-h-[80px]', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(FIELD_CLASS, props.className)} />;
}

// -------------------------------------------------------------- pagination ----

export function Pagination({
  page,
  total,
  pageSize,
  basePath,
}: {
  page: number;
  total: number;
  pageSize: number;
  basePath: string;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const prevPage = page > 1 ? page - 1 : null;
  const nextPage = page < totalPages ? page + 1 : null;

  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
      <span>
        Página {page} de {totalPages}
        <span className="ml-2 text-slate-600">({total} eventos)</span>
      </span>
      <div className="flex gap-2">
        {prevPage ? (
          <a
            href={`${basePath}?page=${prevPage}`}
            className="inline-flex items-center gap-1 rounded-lg border border-ink-600 px-3 py-1.5 text-slate-200 transition-colors hover:bg-ink-800"
          >
            ← Anterior
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-lg border border-ink-700 px-3 py-1.5 text-slate-600 opacity-50 cursor-not-allowed">
            ← Anterior
          </span>
        )}
        {nextPage ? (
          <a
            href={`${basePath}?page=${nextPage}`}
            className="inline-flex items-center gap-1 rounded-lg border border-ink-600 px-3 py-1.5 text-slate-200 transition-colors hover:bg-ink-800"
          >
            Próxima →
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-lg border border-ink-700 px-3 py-1.5 text-slate-600 opacity-50 cursor-not-allowed">
            Próxima →
          </span>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- format ----

/** Centavos → string monetária ("1234" → "12.34"). */
export function fmtCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
