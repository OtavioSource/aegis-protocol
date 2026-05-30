'use client';

import type { ReactNode } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { Button } from '@/components/ui';

export type ActionState = { ok: boolean; message: string; secret?: string };

export const initialActionState: ActionState = { ok: false, message: '' };

export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

function Submit({ label, variant }: { label: string; variant?: 'primary' | 'danger' | 'subtle' | 'ghost' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? 'Submitting…' : label}
    </Button>
  );
}

/**
 * Form genérico ligado a um server action via useFormState. Exibe mensagem de
 * sucesso/erro e, se o action devolver `secret`, mostra-o num bloco destacado
 * (ex: API key de Agent — exibida só uma vez).
 */
export function ActionForm({
  action,
  submitLabel,
  submitVariant,
  children,
}: {
  action: FormAction;
  submitLabel: string;
  submitVariant?: 'primary' | 'danger' | 'subtle' | 'ghost';
  children?: ReactNode;
}) {
  const [state, formAction] = useFormState(action, initialActionState);
  return (
    <form action={formAction} className="space-y-3">
      {children}
      <div className="flex items-center gap-3">
        <Submit label={submitLabel} variant={submitVariant} />
        {state.message ? (
          <span className={state.ok ? 'text-sm text-emerald-400' : 'text-sm text-rose-400'}>
            {state.message}
          </span>
        ) : null}
      </div>
      {state.secret ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs text-amber-300">Save now — shown only once:</p>
          <code className="mt-1 block break-all text-xs text-amber-200">{state.secret}</code>
        </div>
      ) : null}
    </form>
  );
}
