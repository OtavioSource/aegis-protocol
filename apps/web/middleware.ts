import { withAuth } from 'next-auth/middleware';

/**
 * Protege todas as rotas exceto /login, os handlers do NextAuth e assets.
 * Requests não-autenticados são redirecionados para /login.
 */
export default withAuth({
  pages: { signIn: '/login' },
});

export const config = {
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)'],
};
