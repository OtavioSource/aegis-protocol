import Link from 'next/link';
import {
  LayoutDashboard,
  Bot,
  CreditCard,
  CheckSquare,
  Wallet,
  ScrollText,
  Zap,
  Store,
  LogOut,
} from 'lucide-react';
import { signOut } from '../auth';

const nav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/agents', label: 'Agents', icon: Bot },
  { href: '/dashboard/vendors', label: 'Vendors', icon: Store },
  { href: '/dashboard/spend-requests', label: 'Spend Requests', icon: CreditCard },
  { href: '/dashboard/approvals', label: 'Approvals', icon: CheckSquare },
  { href: '/dashboard/treasury', label: 'Treasury', icon: Wallet },
  { href: '/dashboard/audit', label: 'Audit Log', icon: ScrollText },
];

export function Sidebar({ userEmail }: { userEmail?: string }) {
  return (
    <aside className="w-60 bg-gray-900 text-white flex flex-col min-h-screen">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-violet-400" />
          <span className="font-bold text-lg tracking-tight">Aegis Protocol</span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">Agent Governance</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>

      {/* Footer — pb-10 gives clearance from the Next.js dev indicator (fixed bottom-left) */}
      <div className="px-4 pt-4 pb-10 border-t border-gray-800 space-y-3">
        <div>
          <p className="text-xs text-gray-600">Solana Devnet</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-gray-400">Connected</span>
          </div>
        </div>
        {userEmail && (
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/login' });
            }}
          >
            <button
              type="submit"
              className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="truncate">{userEmail}</span>
            </button>
          </form>
        )}
      </div>
    </aside>
  );
}
