/**
 * @file auth.ts
 * @package apps/web
 *
 * NextAuth v5 configuration for the CommandRail dashboard.
 *
 * Uses a Credentials provider that validates email/password against
 * the CommandRail API's /auth/login endpoint (which checks bcrypt hashes).
 *
 * The session stores minimal user data (id, email, name, role) as a JWT.
 * No database adapter needed — the API owns the user record.
 *
 * Usage:
 *   - Server components: const session = await auth()
 *   - Route handler: export const { GET, POST } = handlers
 *   - Middleware: export { auth as middleware } from "./auth"
 */

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        try {
          const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          });

          if (!res.ok) return null;

          const user = await res.json() as {
            id: string;
            email: string;
            name: string | null;
            role: string;
            companyId: string;
          };

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            // Store role and companyId in the token for access control
            role: user.role,
            companyId: user.companyId,
          };
        } catch {
          return null;
        }
      },
    }),
  ],

  pages: {
    signIn: '/login',
  },

  callbacks: {
    // Persist role and companyId into the JWT token
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role;
        token.companyId = (user as { companyId?: string }).companyId;
      }
      return token;
    },
    // Expose role and companyId in the session object
    async session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string; companyId?: string }).role = token.role as string;
        (session.user as { role?: string; companyId?: string }).companyId = token.companyId as string;
      }
      return session;
    },
  },
});
