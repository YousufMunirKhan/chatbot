import { getJson, postJson } from './http';
import type { ChannelKey } from './types';

export interface ProbeResult {
  ok: boolean;
  /** What the provider calls this account, when it tells us. */
  accountName?: string;
  /** Human-readable reason a credential was refused. */
  error?: string;
  /** True when the channel has no cheap way to verify a credential. */
  unverifiable?: boolean;
}

/**
 * Prove a credential actually works before saying "Channel connected".
 *
 * Saving used to report success whatever was typed, and `channel_identities`
 * has no health column, so a mistyped token produced a channel that looked
 * identical to a working one and simply never answered a customer. Each probe
 * below is the cheapest read-only call the provider offers.
 */
export async function probeChannelCredential(params: {
  channel: ChannelKey;
  externalId: string;
  secret: string | null;
  settings?: Record<string, unknown>;
}): Promise<ProbeResult> {
  const { channel, externalId, secret } = params;
  const settings = params.settings ?? {};

  switch (channel) {
    case 'telegram': {
      if (!secret) return { ok: false, error: 'A bot token is required.' };
      const res = await getJson<{ ok?: boolean; result?: { username?: string; id?: number } }>(
        `https://api.telegram.org/bot${secret}/getMe`,
      );
      if (!res.ok || !res.body?.ok) {
        return { ok: false, error: 'Telegram rejected the bot token. Copy it again from BotFather.' };
      }
      const botId = String(res.body.result?.id ?? '');
      if (botId && externalId && botId !== externalId) {
        return {
          ok: false,
          error: `That token belongs to bot ${botId}, not ${externalId}. The id is the digits before ":" in the token.`,
        };
      }
      return { ok: true, accountName: res.body.result?.username ? `@${res.body.result.username}` : undefined };
    }

    case 'viber': {
      if (!secret) return { ok: false, error: 'A Viber auth token is required.' };
      const res = await postJson<{ status?: number; uri?: string; name?: string }>(
        'https://chatapi.viber.com/pa/get_account_info',
        {},
        { headers: { 'X-Viber-Auth-Token': secret } },
      );
      if (!res.ok || (res.body?.status ?? 1) !== 0) {
        return { ok: false, error: 'Viber rejected the auth token.' };
      }
      return { ok: true, accountName: res.body?.name };
    }

    case 'line': {
      // The signing secret cannot be tested; the send token can.
      const accessToken = (settings.accessToken as string) || null;
      if (!accessToken) {
        return { ok: false, error: 'A channel access token is required — replies are sent with it.' };
      }
      const res = await getJson<{ displayName?: string; userId?: string }>('https://api.line.me/v2/bot/info', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return { ok: false, error: 'LINE rejected the channel access token.' };
      const userId = res.body?.userId;
      if (userId && externalId && userId !== externalId) {
        return { ok: false, error: `That token belongs to bot ${userId}, not ${externalId}.` };
      }
      return { ok: true, accountName: res.body?.displayName };
    }

    case 'whatsapp': {
      if (!secret) return { ok: true, unverifiable: true }; // Twilio path needs no token
      const res = await getJson<{ display_phone_number?: string; verified_name?: string; error?: { message?: string } }>(
        `https://graph.facebook.com/v19.0/${externalId}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${secret}` } },
      );
      if (!res.ok) {
        return {
          ok: false,
          error: res.body?.error?.message ?? 'Meta rejected the token, or it cannot see that phone number id.',
        };
      }
      return { ok: true, accountName: res.body?.verified_name ?? res.body?.display_phone_number };
    }

    case 'facebook':
    case 'instagram': {
      if (!secret) return { ok: false, error: 'A page access token is required.' };
      const res = await getJson<{ name?: string; username?: string; error?: { message?: string } }>(
        `https://graph.facebook.com/v19.0/${externalId}?fields=name,username`,
        { headers: { Authorization: `Bearer ${secret}` } },
      );
      if (!res.ok) {
        return {
          ok: false,
          error: res.body?.error?.message ?? 'Meta rejected the token, or it has no access to that account.',
        };
      }
      return { ok: true, accountName: res.body?.name ?? res.body?.username };
    }

    case 'youtube': {
      if (!secret) return { ok: false, error: 'Connect YouTube with the button so a refreshable token is stored.' };
      // A pasted bare token is checked directly; an OAuth credential is JSON.
      let accessToken = secret;
      try {
        const parsed = JSON.parse(secret) as { access_token?: string };
        if (parsed?.access_token) accessToken = parsed.access_token;
      } catch {
        // A bare token — use it as-is.
      }
      const res = await getJson<{ items?: Array<{ id?: string; snippet?: { title?: string } }> }>(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) return { ok: false, error: 'Google rejected the token. Use the Connect button rather than pasting one.' };
      return { ok: true, accountName: res.body?.items?.[0]?.snippet?.title };
    }

    case 'tiktok':
      // TikTok's Business API has no free identity endpoint we can rely on
      // across app types; saying "cannot check" is more honest than a green tick.
      return { ok: true, unverifiable: true };

    case 'email':
      // Inbound-parse needs no credential; Gmail is verified by its OAuth flow.
      return { ok: true, unverifiable: true };

    default:
      return { ok: true, unverifiable: true };
  }
}
