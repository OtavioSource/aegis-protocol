/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@aegis/shared'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
