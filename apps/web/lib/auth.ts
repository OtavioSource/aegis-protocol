/**
 * Configuração do NextAuth (dashboard Aegis).
 *
 * Credentials provider: valida email + senha contra POST /v1/auth/login da API
 * (que confere o bcrypt na tabela User). A sessão é um JWT próprio do NextAuth
 * — a API key (cr_) usada para chamar a API fica só no servidor, em env var.
 */

import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

const API_URL = process.env.AEGIS_API_URL ?? 'http://localhost:4000';

// Mantém a sessão do NextAuth alinhada ao TTL do session token da API (8h,
// ver apps/api/src/lib/session-token.ts). Sem isso, o cookie do NextAuth dura
// 30 dias (default) e sobrevive ao token da API — o middleware não redireciona
// e todo link quebra com 401. Com maxAge = 8h, a sessão expira junto e o
// middleware manda pro /login automaticamente.
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const res = await fetch(`${API_URL}/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
          }),
        });
        if (!res.ok) return null;
        const u = (await res.json()) as {
          id: string;
          email: string;
          name: string;
          role: string;
          companyId: string;
          companyName: string | null;
          sessionToken: string;
        };
        return {
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          companyId: u.companyId,
          companyName: u.companyName,
          sessionToken: u.sessionToken,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.companyId = user.companyId;
        token.companyName = user.companyName;
        // Guarda o token da Aegis API no JWT (cookie httpOnly criptografado).
        // NÃO é copiado para a Session (callback abaixo), então não chega ao browser.
        token.sessionToken = user.sessionToken;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? '';
      session.user.role = token.role;
      session.user.companyId = token.companyId;
      session.user.companyName = token.companyName;
      return session;
    },
  },
};
