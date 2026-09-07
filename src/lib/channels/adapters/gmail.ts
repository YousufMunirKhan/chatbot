import { getJson, postJson, request } from '../http';
import { blocksToText } from '../types';
import type { ChannelAdapter, InboundEvent } from '../types';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

/** Credentials stored (encrypted) on the Gmail channel row. */
export interface GmailCredentials {
  access_token?: string;
  refresh_token?: string;
  /** Epoch milliseconds. */
  expires_at?: number;
  email?: string;
}

export function parseGmailCredentials(secret: string | null): GmailCredentials | null {
  if (!secret) return null;
  try {
    const parsed = JSON.parse(secret) as GmailCredentials;
    return typeof parsed === 'object' && parsed ? parsed : null;
  } catch {
    // A bare access token is still usable until it expires.
    return { access_token: secret };
  }
}

/**
 * Return a valid access token, refreshing when it is within 60s of expiry.
 * Returns the refreshed credentials so the caller can persist them.
 */
export async function ensureGmailAccessToken(
  creds: GmailCredentials,
): Promise<{ accessToken: string | null; refreshed: GmailCredentials | null }> {
  const stillValid = creds.access_token && (!creds.expires_at || creds.expires_at - Date.now() > 60_000);
  if (stillValid) return { accessToken: creds.access_token ?? null, refreshed: null };

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!creds.refresh_token || !clientId || !clientSecret) {
    return { accessToken: creds.access_token ?? null, refreshed: null };
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token',
  });
  const res = await request<{ access_token?: string; expires_in?: number }>(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const accessToken = res.body?.access_token;
  if (!res.ok || !accessToken) return { accessToken: null, refreshed: null };

  const refreshed: GmailCredentials = {
    ...creds,
    access_token: accessToken,
    expires_at: Date.now() + (res.body?.expires_in ?? 3600) * 1000,
  };
  return { accessToken, refreshed };
}

export interface GmailInboundMessage {
  id: string;
  threadId: string;
  from: string;
  fromName?: string;
  subject: string;
  text: string;
}

function headerValue(headers: Array<{ name?: string; value?: string }>, name: string): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

/** Depth-first search for the first text/plain part, falling back to HTML. */
function extractBody(part: GmailPart | undefined): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const found = extractBody(child);
    if (found) return found;
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return decodeBase64Url(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (part.body?.data) return decodeBase64Url(part.body.data);
  return '';
}

/**
 * Strip quoted history so the assistant answers the new message, not the whole
 * thread it is replying to.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((line) =>
    /^\s*(On .+wrote:|-{2,}\s*Original Message|_{5,}|From:\s)/i.test(line),
  );
  const body = (cut >= 0 ? lines.slice(0, cut) : lines)
    .filter((line) => !line.trim().startsWith('>'))
    .join('\n');
  return body.trim();
}

/** Poll unread mail in the inbox. Returns newest-first. */
export async function fetchGmailUnread(accessToken: string, max = 20): Promise<GmailInboundMessage[]> {
  const list = await getJson<{ messages?: Array<{ id?: string }> }>(
    `${GMAIL}/messages?q=${encodeURIComponent('is:unread in:inbox -category:promotions')}&maxResults=${max}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const ids = (list.body?.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  const out: GmailInboundMessage[] = [];
  for (const id of ids) {
    const detail = await getJson<{
      id?: string;
      threadId?: string;
      payload?: GmailPart & { headers?: Array<{ name?: string; value?: string }> };
    }>(`${GMAIL}/messages/${id}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const payload = detail.body?.payload;
    if (!payload) continue;
    const headers = payload.headers ?? [];
    const fromRaw = headerValue(headers, 'From');
    const email = fromRaw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase();
    if (!email) continue;
    const text = stripQuotedReply(extractBody(payload));
    if (!text) continue;
    out.push({
      id: detail.body?.id ?? id,
      threadId: detail.body?.threadId ?? id,
      from: email,
      fromName: fromRaw.replace(/<[^>]*>/, '').replace(/"/g, '').trim() || undefined,
      subject: headerValue(headers, 'Subject') || '(no subject)',
      text,
    });
  }
  return out;
}

/** Remove the UNREAD label so the same mail is not answered twice. */
export async function markGmailRead(accessToken: string, messageId: string): Promise<boolean> {
  const res = await postJson(
    `${GMAIL}/messages/${messageId}/modify`,
    { removeLabelIds: ['UNREAD'] },
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return res.ok;
}

/** Send a reply, threaded onto the original conversation when a threadId is known. */
export async function sendGmail(params: {
  accessToken: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  threadId?: string;
}): Promise<boolean> {
  const subject = params.subject.toLowerCase().startsWith('re:') ? params.subject : `Re: ${params.subject}`;
  const mime = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    params.text,
  ].join('\r\n');
  const raw = Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await postJson(
    `${GMAIL}/messages/send`,
    { raw, ...(params.threadId ? { threadId: params.threadId } : {}) },
    { headers: { Authorization: `Bearer ${params.accessToken}` } },
  );
  return res.ok;
}

/**
 * Gmail is polled rather than pushed (a Pub/Sub watch needs a Google Cloud
 * topic per deployment), so `parse` only accepts events the poller normalised.
 */
export const gmailAdapter: ChannelAdapter = {
  key: 'email',
  label: 'Gmail',
  externalIdHint: 'The Gmail address that receives customer mail',

  parse(payload): InboundEvent[] {
    if (payload && typeof payload === 'object' && Array.isArray((payload as { events?: unknown }).events)) {
      return (payload as { events: InboundEvent[] }).events;
    }
    return [];
  },

  async send(ctx, to, blocks): Promise<boolean> {
    const text = blocksToText(blocks);
    if (!text) return false;
    const creds = parseGmailCredentials(ctx.secret);
    if (!creds) return false;
    const { accessToken } = await ensureGmailAccessToken(creds);
    if (!accessToken) return false;
    return sendGmail({
      accessToken,
      from: ctx.externalId,
      to,
      subject: (ctx.settings.subject as string) ?? 'Re: your message',
      text,
      threadId: ctx.settings.threadId as string | undefined,
    });
  },
};
