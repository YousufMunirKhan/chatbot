import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import {
  ensureGmailAccessToken,
  fetchGmailUnread,
  markGmailRead,
  parseGmailCredentials,
  type GmailCredentials,
} from '../adapters/gmail';
import { handleInboundEvents } from '../handler';
import type { InboundEvent } from '../types';

/** Bounded on purpose: one cron tick must finish inside a request timeout. */
const MAX_IDENTITIES = 25;
const MAX_MESSAGES_PER_IDENTITY = 10;

export interface PollResult {
  identities: number;
  events: number;
  handled: number;
  errors: number;
}

interface IdentityRow {
  id: string;
  company_id: string;
  external_id: string;
  secret_encrypted: string | null;
  settings_json: Record<string, unknown> | null;
}

function decrypt(value: string | null): string | null {
  if (!value) return null;
  try {
    return decryptSecret(value);
  } catch {
    return value; // tolerate a plaintext credential blob in dev/test
  }
}

/**
 * Poll every connected Gmail mailbox for unread customer mail.
 *
 * Gmail push (Pub/Sub `users.watch`) needs a Google Cloud topic per deployment,
 * so polling is what actually works out of the box. Each message is handed to
 * the same `handleInboundEvents` pipeline every webhook uses — the AI reply,
 * the inbox record and the dedupe are all shared.
 *
 * The reply has to be threaded onto the original mail, and the adapter reads
 * `subject`/`threadId` from the identity's settings, so those are written to the
 * row immediately before each message is processed.
 */
export async function pollGmailIdentities(): Promise<PollResult> {
  const result: PollResult = { identities: 0, events: 0, handled: 0, errors: 0 };
  const sb = createSupabaseServiceClient();

  const mailboxes = await listGmailIdentities(sb);
  if (!mailboxes) return { ...result, errors: 1 };

  for (const raw of mailboxes) {
    result.identities += 1;
    try {
      await pollOneMailbox(sb, raw, result);
    } catch (err) {
      result.errors += 1;
      // Never let one broken mailbox stop the rest of the run.
      logger.error('Gmail poll failed for a mailbox', {
        externalId: raw.external_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

/**
 * The active OAuth-connected mailboxes, newest first.
 *
 * The provider lives inside `settings_json`, so the filter is pushed into
 * PostgREST as a JSON accessor. If a deployment's PostgREST rejects that
 * expression the query is retried unfiltered and narrowed here — a poller that
 * silently returns zero mailboxes would look exactly like "no new mail".
 */
async function listGmailIdentities(
  sb: ReturnType<typeof createSupabaseServiceClient>,
): Promise<IdentityRow[] | null> {
  const columns = 'id,company_id,external_id,secret_encrypted,settings_json';
  const { data, error } = await sb
    .from('channel_identities')
    .select(columns)
    .eq('channel', 'email')
    .eq('is_active', true)
    .eq('settings_json->>provider', 'gmail')
    .limit(MAX_IDENTITIES);
  if (!error) return (data ?? []) as IdentityRow[];

  logger.warn('Gmail poller falling back to an unfiltered identity query', { error: error.message });
  const fallback = await sb
    .from('channel_identities')
    .select(columns)
    .eq('channel', 'email')
    .eq('is_active', true)
    .limit(200);
  if (fallback.error) {
    logger.error('Gmail poller could not list identities', { error: fallback.error.message });
    return null;
  }
  return ((fallback.data ?? []) as IdentityRow[])
    .filter((row) => row.settings_json?.provider === 'gmail')
    .slice(0, MAX_IDENTITIES);
}

async function pollOneMailbox(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  row: IdentityRow,
  result: PollResult,
): Promise<void> {
  const creds = parseGmailCredentials(decrypt(row.secret_encrypted));
  if (!creds) return;

  const { accessToken, refreshed } = await ensureGmailAccessToken(creds);
  if (refreshed) await persistCredentials(sb, row.id, refreshed);
  if (!accessToken) {
    logger.warn('Gmail mailbox has no usable access token', { externalId: row.external_id });
    return;
  }

  const messages = await fetchGmailUnread(accessToken, MAX_MESSAGES_PER_IDENTITY);
  const settings = row.settings_json ?? {};

  for (const message of messages.slice(0, MAX_MESSAGES_PER_IDENTITY)) {
    try {
      // The reply is sent by the email adapter, which reads these from the
      // identity row, so they must be current before the pipeline runs.
      await sb
        .from('channel_identities')
        .update({ settings_json: { ...settings, provider: 'gmail', subject: message.subject, threadId: message.threadId } })
        .eq('id', row.id);

      const event: InboundEvent = {
        externalId: row.external_id,
        from: message.from,
        fromName: message.fromName,
        text: message.text,
        messageId: message.id,
        kind: 'message',
      };
      result.events += 1;
      const outcome = await handleInboundEvents('email', [event]);
      result.handled += outcome.handled;

      // Cleared last: a crash before this point simply re-delivers the mail, and
      // the inbound dedupe table stops it being answered twice.
      await markGmailRead(accessToken, message.id);
    } catch (err) {
      result.errors += 1;
      logger.error('Gmail message handling failed', {
        externalId: row.external_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function persistCredentials(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  id: string,
  creds: GmailCredentials,
): Promise<void> {
  try {
    await sb
      .from('channel_identities')
      .update({ secret_encrypted: encryptSecret(JSON.stringify(creds)) })
      .eq('id', id);
  } catch (err) {
    logger.warn('Could not persist refreshed Gmail credentials', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
