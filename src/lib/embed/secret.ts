import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';

/**
 * Server-side access to a bot's mobile-embed signing secret.
 *
 * Kept apart from `./identity` so that the signing/verification logic stays a
 * pure function with no database and no ENCRYPTION_KEY dependency — that is
 * what makes it testable, and what lets the embed page fail soft when the key
 * is missing (every visitor is simply anonymous) instead of 500-ing.
 */
export async function getBotEmbedSecret(params: {
  botId: string;
  companyId: string;
}): Promise<string | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('bots')
    .select('mobile_embed_secret_encrypted')
    .eq('id', params.botId)
    .eq('company_id', params.companyId) // scope guard
    .maybeSingle();

  const stored = (data as { mobile_embed_secret_encrypted?: string | null } | null)
    ?.mobile_embed_secret_encrypted;
  if (!stored) return null;

  try {
    return decryptSecret(stored);
  } catch {
    // A rotated or missing ENCRYPTION_KEY must not lock customers out of chat.
    logger.warn('Could not decrypt the mobile embed secret; treating visitors as anonymous', {
      companyId: params.companyId,
      botId: params.botId,
      module: 'embed',
    });
    return null;
  }
}
