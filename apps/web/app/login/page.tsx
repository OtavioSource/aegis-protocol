'use client';

import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { Button, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const res = await signIn('credentials', {
      email: String(fd.get('email') ?? ''),
      password: String(fd.get('password') ?? ''),
      redirect: false,
    });
    setPending(false);
    if (!res || res.error) {
      setError('Invalid email or password.');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-slate-100">Aegis Protocol</h1>
          <p className="mt-1 text-sm text-slate-500">Governance Console</p>
        </div>
        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-xl border border-ink-700 bg-ink-850 p-6"
        >
          <Field label="Email">
            <Input name="email" type="email" required autoComplete="email" placeholder="admin@aegis-demo.com" />
          </Field>
          <Field label="Password">
            <Input name="password" type="password" required autoComplete="current-password" />
          </Field>
          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}
