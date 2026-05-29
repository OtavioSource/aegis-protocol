'use client';

import {
  ArrowUpDown,
  BarChart3,
  BotMessageSquare,
  Building2,
  CheckCircle2,
  FileClock,
  LayoutDashboard,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/components/ui';

const LINKS = [
  { href: '/', label: 'Visão geral', icon: LayoutDashboard },
  { href: '/spend-requests', label: 'Spend Requests', icon: ArrowUpDown },
  { href: '/approvals', label: 'Aprovações', icon: CheckCircle2 },
  { href: '/policies', label: 'Políticas', icon: ShieldCheck },
  { href: '/agents', label: 'Agentes', icon: BotMessageSquare },
  { href: '/vendors', label: 'Vendors', icon: Building2 },
  { href: '/fiat', label: 'Fiat ramp', icon: Wallet },
  { href: '/audit', label: 'Auditoria', icon: FileClock },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="space-y-0.5" aria-label="Menu principal">
      {LINKS.map((link) => {
        const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-1 focus-visible:ring-offset-ink-900',
              active
                ? 'bg-accent-soft text-accent'
                : 'text-slate-400 hover:bg-ink-800 hover:text-slate-200',
            )}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={16} aria-hidden="true" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
