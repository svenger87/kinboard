import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async redirects() {
    return [
      // Renamed slugs under /rezepte (specific first, then catch-all)
      { source: '/rezepte/neu', destination: '/recipes/new', permanent: true },
      { source: '/rezepte/suchen', destination: '/recipes/search', permanent: true },
      { source: '/rezepte/:id/bearbeiten', destination: '/recipes/:id/edit', permanent: true },
      { source: '/rezepte/:path*', destination: '/recipes/:path*', permanent: true },
      // Other German slugs -> English (NOT /einkaufen — see rewrites below;
      // it's the Shopping PWA's start_url + scope, redirecting it would
      // break PWA standalone mode by carrying the URL out of scope).
      { source: '/energie/:path*', destination: '/energy/:path*', permanent: true },
      { source: '/hausautomation/:path*', destination: '/home-automation/:path*', permanent: true },
      { source: '/kameras/:path*', destination: '/cameras/:path*', permanent: true },
      { source: '/mahlzeiten/:path*', destination: '/meals/:path*', permanent: true },
      { source: '/notizen/:path*', destination: '/notes/:path*', permanent: true },
    ];
  },
  async rewrites() {
    return [
      // /einkaufen is the Shopping PWA's start_url + scope (see
      // public/manifest-shopping.json). Redirecting it 308→/shopping
      // would carry the launched URL out of the PWA's scope, which iOS
      // detects as a scope violation and bounces the page to Safari
      // instead of keeping it in PWA standalone mode. A rewrite keeps
      // the browser URL at /einkaufen while internally serving the
      // /shopping page — PWA scope intact, single source of truth for
      // the shopping UI.
      { source: '/einkaufen', destination: '/shopping' },
      { source: '/einkaufen/:path*', destination: '/shopping/:path*' },
    ];
  },
};

export default withNextIntl(nextConfig);
