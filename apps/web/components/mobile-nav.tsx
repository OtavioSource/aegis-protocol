'use client';

import { Menu, ShieldCheck, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Nav } from '@/components/nav';
import { SignOutButton } from '@/components/sign-out-button';

type Props = {
  name: string;
  role: string;
  companyName?: string | null;
};

export function MobileNav({ name, role, companyName }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      {/* Top bar — visível apenas em mobile (< md) */}
      <div className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between border-b border-ink-700 bg-ink-900 px-4 md:hidden">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="shrink-0 text-accent" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-100">Aegis Protocol</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-ink-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          aria-label="Abrir menu de navegação"
          aria-expanded={open}
          aria-controls="mobile-drawer"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
      </div>

      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={[
          'fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 md:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
      />

      {/* Drawer */}
      <aside
        id="mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navegação"
        className={[
          'fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r border-ink-700 bg-ink-900 p-4 md:hidden',
          'transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="shrink-0 text-accent" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold leading-tight text-slate-100">Aegis Protocol</p>
              <p className="text-xs leading-tight text-slate-500">{companyName ?? 'Console'}</p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-ink-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            aria-label="Fechar menu"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <Nav />

        <div className="mt-auto border-t border-ink-700 pt-3">
          <p className="truncate text-xs text-slate-300">{name}</p>
          <p className="mb-1.5 text-xs text-slate-500">{role}</p>
          <SignOutButton />
        </div>
      </aside>
    </>
  );
}
