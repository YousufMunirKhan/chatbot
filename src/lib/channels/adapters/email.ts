import { sendChannelEmail } from '../email';
import { blocksToText } from '../types';
import type { ChannelAdapter, InboundEvent } from '../types';
import { ensureGmailAccessToken, parseGmailCredentials, sendGmail } from './gmail';

/**
 * Email channel.
 *
 * Two providers share one channel key so the inbox, flows and reporting treat
 * mail uniformly:
 *  - `inbound_parse` (default) — any provider that POSTs inbound mail to
 *    /api/webhooks/email, replied to through EMAIL_API_URL.
 *  - `gmail` — an OAuth-connected mailbox, polled by the cron job and replied to
 *    in-thread through the Gmail API.
 */
export const emailAdapter: ChannelAdapter = {
  key: 'email',
  label: 'Email & Gmail',
  externalIdHint: 'The inbox address customers write to',

  parse(payload): InboundEvent[] {
    // Inbound mail arrives through the dedicated /api/webhooks/email route (it
    // has to accept form posts as well as JSON) and the Gmail poller normalises
    // its own events, so both hand us a ready-made event list.
    if (payload && typeof payload === 'object' && Array.isArray((payload as { events?: unknown }).events)) {
      return (payload as { events: InboundEvent[] }).events;
    }
    return [];
  },

  async send(ctx, to, blocks): Promise<boolean> {
    const text = blocksToText(blocks);
    if (!text) return false;
    const subject = (ctx.settings.subject as string) || 'Re: your message';

    if (ctx.settings.provider === 'gmail') {
      const creds = parseGmailCredentials(ctx.secret);
      if (!creds) return false;
      const { accessToken } = await ensureGmailAccessToken(creds);
      if (!accessToken) return false;
      return sendGmail({
        accessToken,
        from: ctx.externalId,
        to,
        subject,
        text,
        threadId: ctx.settings.threadId as string | undefined,
      });
    }

    return sendChannelEmail({ to, from: ctx.externalId, subject, text });
  },
};
