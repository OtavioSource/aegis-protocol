import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@aegis/shared'],
  experimental: {
    typedRoutes: true,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_COMMIT_SHA: commitSha,
  },
};

export default nextConfig;
