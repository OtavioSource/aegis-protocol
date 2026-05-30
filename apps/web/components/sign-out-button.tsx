'use client';

import { signOut } from 'next-auth/react';

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="text-xs text-slate-400 hover:text-slate-200"
    >
      Sign out
    </button>
  );
}
