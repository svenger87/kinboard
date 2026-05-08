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
  async rewrites() {
    return [
      // /einkaufen is the Shopping PWA's start_url + scope (see
      // public/manifest-shopping.json). Internally serves /shopping's
      // content — the historic /einkaufen route was dropped (a 793-line
      // duplicate of /shopping that had silently diverged) so this
      // rewrite is the single bridge. Three reasons we keep the URL
      // alias instead of pointing the manifest at /shopping:
      //
      //   1. Existing iOS-installed Shopping PWAs cached scope=/einkaufen
      //      at install time. iOS doesn't re-fetch the manifest until
      //      reinstall, so changing the manifest breaks every device's
      //      "Open in App" banner until the user manually reinstalls.
      //
      //   2. iOS Safari triggers its "Open in [App]" banner when the
      //      navigated URL matches an installed PWA's cached scope.
      //      With a rewrite (not redirect), the URL stays /einkaufen
      //      so the scope-match fires on the navigated URL, not on the
      //      post-redirect URL — iOS bounces the user into the
      //      standalone PWA instead of staying in Safari.
      //
      //   3. The push-notification URLs in /api/cron/process-notifications
      //      and /api/notifications/{debug-trigger,send-batch} also
      //      stay at /einkaufen so a tapped notification opens the
      //      installed standalone PWA, not Safari.
      { source: '/einkaufen', destination: '/shopping' },
      { source: '/einkaufen/:path*', destination: '/shopping/:path*' },
    ];
  },
};

export default withNextIntl(nextConfig);
