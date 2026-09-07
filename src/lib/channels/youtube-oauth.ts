import { env } from '@/lib/env';

/**
 * Shared between the YouTube start and callback routes. It lives outside both
 * because a Next route file may only export HTTP handlers and route config.
 * The value must match the redirect URI registered on the Google OAuth client.
 */
export function youtubeRedirectUri(): string {
  return `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/api/channels/youtube/callback`;
}
