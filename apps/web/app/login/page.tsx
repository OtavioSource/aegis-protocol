import { signIn } from '../../auth';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { Zap, AlertCircle } from 'lucide-react';

type SearchParams = Promise<{ error?: string; callbackUrl?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const error = params.error;
  const callbackUrl = params.callbackUrl ?? '/dashboard';

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="p-2 bg-violet-600 rounded-lg">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <div>
            <p className="font-bold text-white text-xl tracking-tight">CommandRail</p>
            <p className="text-gray-500 text-xs">Agent Governance Platform</p>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 shadow-2xl">
          <h1 className="text-lg font-semibold text-white mb-1">Sign in</h1>
          <p className="text-gray-400 text-sm mb-6">Access your governance dashboard</p>

          {error && (
            <div className="flex items-center gap-2 bg-red-950 border border-red-800 rounded-lg px-3 py-2.5 mb-4">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-300">
                {error === 'CredentialsSignin' ? 'Invalid email or password.' : 'Authentication failed. Try again.'}
              </p>
            </div>
          )}

          <form
            action={async (formData: FormData) => {
              'use server';
              try {
                await signIn('credentials', {
                  email: formData.get('email'),
                  password: formData.get('password'),
                  redirectTo: callbackUrl,
                });
              } catch (err) {
                // NextAuth v5 throws AuthError on failed credentials.
                // NEXT_REDIRECT is not an AuthError — it must be rethrown
                // so Next.js can perform the redirect on success.
                if (err instanceof AuthError) {
                  redirect(`/login?error=${err.type}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
                }
                throw err;
              }
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Email</label>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="admin@acme.com"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Password</label>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-violet-600 hover:bg-violet-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors mt-2"
            >
              Sign in
            </button>
          </form>

          <p className="text-xs text-gray-600 text-center mt-6">
            Demo: <span className="text-gray-400">admin@acme.com</span> /{' '}
            <span className="text-gray-400">commandrail</span>
          </p>
        </div>
      </div>
    </div>
  );
}
