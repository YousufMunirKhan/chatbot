import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import { getChannelAdapter, isChannelKey } from '@/lib/channels/registry';
import { textBlocks, type ChannelSendContext } from '@/lib/channels/types';
import { logger } from '@/lib/logger';
import { getWhatsAppServiceWindow } from '@/lib/channels/whatsapp';
import { serviceWindowRefusalReason } from '@/lib/channels/whatsapp-window';

/**
 * Outbound delivery for `POST /api/v1/messages`.
 *
 * Reuses the channel adapters exactly as the inbound webhook path does: resolve
 * the company's connected account for the channel, decrypt its token, and hand
 * the text to the adapter. Nothing under `src/lib/channels/` is modified — this
 * is a caller, not a change.
 *
 * `web_chat` and `api` conversations have no external transport: the message row
 * itself IS the delivery (the widget and the inbox read it), so those report
 * `transport: 'in_app'` rather than a failure.
 */

export interface DeliveryOutcome {
  delivered: boolean;
  transport: 'in_app' | 'channel';
  reason?: string;
}

const IN_APP_CHANNELS = new Set(['web_chat', 'api', 'voice', 'phone']);

export async function deliverApiMessage(params: {
  companyId: string;
  channel: string;
  to: string;
  text: string;
}): Promise<DeliveryOutcome> {
  if (IN_APP_CHANNELS.has(params.channel)) {
    return { delivered: true, transport: 'in_app' };
  }
  if (!isChannelKey(params.channel)) {
    return { delivered: false, transport: 'channel', reason: `Unsupported channel "${params.channel}".` };
  }
  const adapter = getChannelAdapter(params.channel);
  if (!adapter) {
    return { delivered: false, transport: 'channel', reason: `No adapter for "${params.channel}".` };
  }

  // TENANT ISOLATION: the connected account must belong to the key's company.
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('channel_identities')
    .select('external_id,secret_encrypted,settings_json')
    .eq('company_id', params.companyId)
    .eq('channel', params.channel)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!data) {
    return {
      delivered: false,
      transport: 'channel',
      reason: `No active ${params.channel} channel is connected for this account.`,
    };
  }

  const row = data as {
    external_id: string;
    secret_encrypted: string | null;
    settings_json: Record<string, unknown> | null;
  };

  let secret: string | null = null;
  if (row.secret_encrypted) {
    try {
      secret = decryptSecret(row.secret_encrypted);
    } catch {
      secret = row.secret_encrypted; // tolerate a plaintext token in dev/test
    }
  }

  const ctx: ChannelSendContext = {
    companyId: params.companyId,
    channel: adapter.key,
    externalId: row.external_id,
    secret,
    settings: row.settings_json ?? {},
  };

  // A message pushed through the public API is initiated by the customer's own
  // system, so nothing guarantees the recipient wrote to them recently.
  if (adapter.key === 'whatsapp') {
    const refusal = serviceWindowRefusalReason(
      await getWhatsAppServiceWindow(params.companyId, params.to),
    );
    if (refusal) return { delivered: false, transport: 'channel', reason: refusal };
  }

  try {
    const sent = await adapter.send(ctx, params.to, textBlocks(params.text));
    return sent
      ? { delivered: true, transport: 'channel' }
      : { delivered: false, transport: 'channel', reason: 'The channel provider rejected the message.' };
  } catch (err) {
    logger.warn('API message delivery failed', {
      companyId: params.companyId,
      module: 'api/v1',
      error: err instanceof Error ? err.message : String(err),
    });
    return { delivered: false, transport: 'channel', reason: 'Delivery failed.' };
  }
}
