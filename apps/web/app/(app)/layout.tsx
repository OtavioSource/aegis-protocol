import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Nav } from '@/components/nav';
import { SignOutButton } from '@/components/sign-out-button';
import { authOptions } from '@/lib/auth';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-ink-700 bg-ink-900 p-4">
        <div className="mb-6">
          <p className="text-sm font-semibold text-slate-100">Aegis Protocol</p>
          <p className="text-xs text-slate-500">
            {session.user.companyName ?? 'Console'}
          </p>
        </div>
        <Nav />
        <div className="mt-auto border-t border-ink-700 pt-3">
          <p className="truncate text-xs text-slate-300">{session.user.name}</p>
          <p className="mb-1.5 text-xs text-slate-500">{session.user.role}</p>
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden p-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
