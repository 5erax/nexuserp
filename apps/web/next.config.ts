import type { NextConfig } from 'next';
import path from 'node:path';
const apiOrigin = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  transpilePackages: ['@nexus/ui', '@nexus/contracts'],
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: apiOrigin + '/api/v1/:path*' }];
  },
};
export default config;
