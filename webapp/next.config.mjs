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
      // German slugs -> English (NOT /einkaufen — see rewrites below).
      { source: '/energie/:path*', destination: '/energy/:path*', permanent: true },
      { source: '/hausautomation/:path*', destination: '/home-automation/:path*', permanent: true },
      { source: '/kameras/:path*', destination: '/cameras/:path*', permanent: true },
      { source: '/mahlzeiten/:path*', destination: '/meals/:path*', permanent: true },
      { source: '/notizen/:path*', destination: '/notes/:path*', permanent: true },
    ];
  },
  // (No `/einkaufen` → `/shopping` rewrite. /einkaufen is a real Next
  // route at src/app/einkaufen/{layout,page}.tsx — its layout sets
  // the Shopping PWA's per-route metadata (manifest-shopping.json,
  // shopping icons, "Einkauf" appleWebApp.title), and the page itself
  // is the kiosk-optimized offline-first surface (useOfflineShopping,
  // OfflineBanner, leaner UI than /shopping). The two are deliberately
  // distinct: /shopping is the desktop/full-feature page, /einkaufen
  // is the standalone-PWA kiosk page. Do not collapse them into one.)
};

export default withNextIntl(nextConfig);
