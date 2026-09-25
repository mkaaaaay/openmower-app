import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@mapbox/mapbox-gl-draw', 'mqtt'],
  // Dev server is reached as "mkay:3000" from the browser, not "localhost" —
  // without this Next.js blocks the HMR/webpack dev resources and the page
  // stays blank.
  allowedDevOrigins: ['mkay'],
};

export default nextConfig;
