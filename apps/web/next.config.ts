import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  transpilePackages: ['@command-rail/shared'],
  experimental: {
    turbo: {
      root: path.resolve(__dirname, '../..'),
    },
  },
};

export default nextConfig;
