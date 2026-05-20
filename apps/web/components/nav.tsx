'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/components/ui';

const LINKS = [
  { href: '/', label: 'Visão geral' },
  { href: '/spend-requests', label: 'Spend Requests' },
  { href: '/approvals', label: 'Aprovações' },
  { href: '/policies', label: 'Políticas' },
  { href: '/agents', label: 'Agentes' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/fiat', label: 'Fiat ramp' },
  { href: '/audit', label: 'Auditoria' },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="space-y-0.5">
      {LINKS.map((link) => {
        const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'block rounded-lg px-3 py-1.5 text-sm',
              active
                ? 'bg-accent-soft text-accent'
                : 'text-slate-400 hover:bg-ink-800 hover:text-slate-200',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
