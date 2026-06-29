import type { MetadataRoute } from 'next';

/**
 * PWA manifest so agents can install the inbox as an app on phones/tablets and
 * launch straight into the conversation list. Served at /manifest.webmanifest
 * and auto-linked by Next.js.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Switch & Save Agent Inbox',
    short_name: 'Agent Inbox',
    description: 'Reply to customer conversations on the go.',
    start_url: '/company/inbox',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#045fff',
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
