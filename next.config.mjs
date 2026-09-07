/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Dashboard data is live, so don't serve a stale client-side Router Cache
    // copy on navigation — always re-fetch dynamic routes (Next 14.2+).
    // Without this, navigating between routes showed ~30s-old data until a full
    // URL reload.
    // `static` must be pinned too: lazily-created prefetch entries (the ones the
    // router builds on hover/viewport in dev) are tagged `PrefetchKind.AUTO` and
    // land in the `static` bucket, which otherwise defaults to 300s.
    staleTimes: { dynamic: 0, static: 0 },
  },
  // The embeddable widget is served as a static asset and must be loadable
  // cross-origin from any customer website (domain allow-listing is enforced
  // server-side, see Module 8 / Module 23).
  async headers() {
    return [
      {
        source: '/widget/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=86400' },
        ],
      },
      {
        // The mobile embed bridge. Loaded same-origin by /embed/[publicBotId],
        // so it needs no CORS — but a WebView on a phone network benefits from
        // the same cache policy as the widget.
        source: '/sdk/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=300, s-maxage=86400' }],
      },
    ];
  },
};

export default nextConfig;
