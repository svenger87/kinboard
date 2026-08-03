import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // node-ical (used by /api/calendar/test-ics + /api/cron/sync-ics) has
  // transitive deps that evaluate BigInt-using code during Next's static
  // page-data collection step, causing `TypeError: s.BigInt is not a
  // function` at build time. Marking node-ical + its temporal-polyfill
  // transitive dep as server-external tells Next NOT to bundle them —
  // the API routes do plain Node require() at runtime where BigInt
  // is globally available and the polyfill resolves normally.
  serverExternalPackages: ['node-ical', 'temporal-polyfill', 'yahoo-finance2'],
  // Force-include node-ical's whole dependency tree in the standalone
  // bundle so the runtime require() finds it — without this, Next's
  // file-tracing skips packages it didn't trace through bundle imports.
  outputFileTracingIncludes: {
    '/api/calendar/test-ics': [
      './node_modules/node-ical/**/*',
      './node_modules/temporal-polyfill/**/*',
      './node_modules/ical.js/**/*',
      './node_modules/rrule/**/*',
      './node_modules/luxon/**/*',
      './node_modules/moment-timezone/**/*',
    ],
    '/api/cron/sync-ics': [
      './node_modules/node-ical/**/*',
      './node_modules/temporal-polyfill/**/*',
      './node_modules/ical.js/**/*',
      './node_modules/rrule/**/*',
      './node_modules/luxon/**/*',
      './node_modules/moment-timezone/**/*',
    ],
    '/api/stonks/quote': ['./node_modules/yahoo-finance2/**/*'],
    '/api/stonks/chart': ['./node_modules/yahoo-finance2/**/*'],
    '/api/stonks/search': ['./node_modules/yahoo-finance2/**/*'],
  },
  images: {
    // The image optimizer is off, which also disables /_next/image.
    //
    // It was configured with `remotePatterns: [{ hostname: '**' }]`,
    // which turned that endpoint into an open image proxy: anyone able
    // to reach a Kinboard instance could make the server fetch and
    // decode an arbitrary remote image. Verified against both a family
    // box and the public demo before changing it.
    //
    // That mattered because Next bundles its own sharp (0.34.5, below
    // the 0.35.0 that patches a batch of libvips CVEs) into the runtime
    // container, so the decoder handling those attacker-chosen images
    // was the vulnerable one.
    //
    // Nothing needed it. Every <Image> in the app with a remote src
    // already passes `unoptimized`, and every other image is a plain
    // <img>. Turning the optimizer off costs nothing and removes the
    // endpoint entirely, rather than trying to enumerate safe hosts for
    // user-supplied shopping and recipe images that can legitimately
    // come from anywhere.
    unoptimized: true,
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
      // Legacy Tesla route superseded by /vehicles (multi-vendor, multi-car).
      { source: '/tesla', destination: '/vehicles', permanent: true },
      // Legacy Tesla settings route superseded by /settings/vehicles.
      { source: '/settings/tesla', destination: '/settings/vehicles', permanent: true },
      // Legacy HA-nested energy settings superseded by top-level /settings/energy.
      { source: '/settings/homeassistant/energy', destination: '/settings/energy', permanent: true },
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
