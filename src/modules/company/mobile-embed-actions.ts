'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { encryptSecret } from '@/lib/crypto';
import { generateEmbedSecret } from '@/lib/embed/identity';
import { getBotEmbedSecret } from '@/lib/embed/secret';
import { getCompanyId } from './data';

/**
 * The signing secret a host native app uses to prove "this is customer 123".
 *
 * Two rules shape this file:
 *  - it is company-admin only. An agent has no reason to hold a key that can
 *    mint any customer identity.
 *  - the secret is written encrypted and read back only on explicit request,
 *    never as part of rendering the page.
 */

export type MobileEmbedActionState = {
  error?: string;
  ok?: boolean;
  okText?: string;
  /** Present only immediately after a reveal or regenerate. */
  secret?: string;
};

const botSchema = z.object({ botId: z.string().uuid() });

async function assertOwnBot(botId: string, companyId: string): Promise<boolean> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('bots')
    .select('id')
    .eq('id', botId)
    .eq('company_id', companyId) // scope guard
    .maybeSingle();
  return Boolean(data);
}

/**
 * Show the current secret, creating one on first use.
 *
 * Creating on reveal (rather than on bot creation) means a company that never
 * ships a mobile app never has a signing key at all — one fewer secret in the
 * database that nobody is watching.
 */
export async function revealEmbedSecretAction(
  _prev: MobileEmbedActionState,
  formData: FormData,
): Promise<MobileEmbedActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = botSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Choose an assistant first.' };
  if (!(await assertOwnBot(parsed.data.botId, companyId))) return { error: 'Assistant not found.' };

  const existing = await getBotEmbedSecret({ botId: parsed.data.botId, companyId });
  if (existing) return { ok: true, secret: existing };

  const secret = generateEmbedSecret();
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('bots')
    .update({ mobile_embed_secret_encrypted: encryptSecret(secret) })
    .eq('id', parsed.data.botId)
    .eq('company_id', companyId);
  if (error) return { error: 'Could not create a signing secret. Check that ENCRYPTION_KEY is set.' };

  revalidatePath('/company/widget');
  return { ok: true, secret, okText: 'A signing secret has been created.' };
}

/**
 * Replace the secret. Every signature generated with the old one stops
 * verifying immediately, which is the point — but it also means every already
 * installed copy of the host app that signs with the old key drops back to
 * anonymous until it is redeployed. Said plainly in the UI.
 */
export async function regenerateEmbedSecretAction(
  _prev: MobileEmbedActionState,
  formData: FormData,
): Promise<MobileEmbedActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = botSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Choose an assistant first.' };
  if (!(await assertOwnBot(parsed.data.botId, companyId))) return { error: 'Assistant not found.' };

  const secret = generateEmbedSecret();
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('bots')
    .update({ mobile_embed_secret_encrypted: encryptSecret(secret) })
    .eq('id', parsed.data.botId)
    .eq('company_id', companyId);
  if (error) return { error: 'Could not replace the signing secret. Check that ENCRYPTION_KEY is set.' };

  revalidatePath('/company/widget');
  return {
    ok: true,
    secret,
    okText: 'New secret created. Update your app server — signatures made with the old one no longer verify.',
  };
}
