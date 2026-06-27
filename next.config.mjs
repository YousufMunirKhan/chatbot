/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Dashboard data is live, so don't serve a stale client-side Router Cache
    // copy on navigation — always re-fetch dynamic routes (Next 14.2+).
    // Without this, navigating between routes showed ~30s-old data until a full
    // URL reload.
    staleTimes: { dynamic: 0 },
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
    ];
  },
};

export default nextConfig;
