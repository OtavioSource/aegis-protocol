import { ShieldCheck } from 'lucide-react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { MobileNav } from '@/components/mobile-nav';
import { Nav } from '@/components/nav';
import { SignOutButton } from '@/components/sign-out-button';
import { authOptions } from '@/lib/auth';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <div className="flex min-h-dvh">
      <a href="#main-content" className="skip-link">
        Pular para o conteúdo
      </a>

      {/* Mobile: top bar fixo + drawer deslizante */}
      <MobileNav
        name={session.user.name ?? ''}
        role={session.user.role}
        companyName={session.user.companyName}
      />

      {/* Desktop sidebar — escondido em mobile */}
      <aside className="hidden md:flex w-56 flex-col border-r border-ink-700 bg-ink-900 p-4">
        <div className="mb-6 flex items-center gap-2">
          <ShieldCheck size={18} className="shrink-0 text-accent" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold leading-tight text-slate-100">Aegis Protocol</p>
            <p className="text-xs leading-tight text-slate-500">
              {session.user.companyName ?? 'Console'}
            </p>
          </div>
        </div>

        <Nav />

        <div className="mt-auto border-t border-ink-700 pt-3">
          <p className="truncate text-xs text-slate-300">{session.user.name}</p>
          <p className="mb-1.5 text-xs text-slate-500">{session.user.role}</p>
          <SignOutButton />
          <p className="mt-3 text-[10px] text-slate-600 tabular-nums">
            v{process.env.NEXT_PUBLIC_APP_VERSION} · {process.env.NEXT_PUBLIC_COMMIT_SHA}
          </p>
        </div>
      </aside>

      {/* Main — pt compensa a top bar fixa no mobile */}
      <main
        id="main-content"
        className="flex-1 overflow-x-hidden px-4 pb-8 pt-[72px] md:p-8"
        tabIndex={-1}
      >
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
