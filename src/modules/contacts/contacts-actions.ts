'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from '@/modules/company/data';

/**
 * Everything an agent can change about a person.
 *
 * The identity itself — which emails and phones belong to whom — is settled in
 * the database (migration 0076), because it also has to hold for the pre-chat
 * form, the assistant's lead tool, the public API and the shop sync, none of
 * which come through here. So `addContactAddressAction` calls
 * `contact_add_identity` rather than writing the array itself: the function
 * takes the lock, spots that the address already belongs to someone else, and
 * folds the two records together, which is not something a client can do
 * safely with two round trips.
 *
 * Everything else on this page — the name, notes, tags, free-form details — is
 * ordinary company-scoped data, and every write below carries the session
 * user's own company id. The service-role client bypasses RLS, so that filter
 * is the tenant boundary.
 */

export type ActionState = { error?: string; ok?: boolean };

const uuid = z.string().uuid();

/** Confirms the contact is this company's before anything is written to it. */
async function assertOwnContact(companyId: string, contactId: string): Promise<boolean> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('contacts')
    .select('id')
    .eq('company_id', companyId)
    .eq('id', contactId)
    .maybeSingle();
  return Boolean(data);
}

function revalidateContact(contactId: string): void {
  revalidatePath('/company/customers');
  revalidatePath(`/company/customers/${contactId}`);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

const noteSchema = z.object({
  contactId: uuid,
  body: z.string().trim().min(1, 'Write something first').max(4000, 'That note is too long'),
});

export async function addContactNoteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = noteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { contactId, body } = parsed.data;

  if (!(await assertOwnContact(companyId, contactId))) return { error: 'No such contact.' };

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('contact_notes').insert({
    company_id: companyId,
    contact_id: contactId,
    author_id: user.userId,
    body,
  });
  if (error) return { error: error.message };

  revalidateContact(contactId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Name
// ---------------------------------------------------------------------------

const renameSchema = z.object({
  contactId: uuid,
  name: z.string().trim().max(200, 'That name is too long'),
});

/**
 * A person's name is the one identity field an agent may overwrite outright.
 * The addresses are how we recognise them and are never silently replaced, but
 * a shop API calling somebody "guest" is exactly what a human is here to fix.
 */
export async function renameContactAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = renameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { contactId, name } = parsed.data;

  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('contacts')
    .update({ display_name: name || null })
    .eq('id', contactId)
    .eq('company_id', companyId); // scope guard
  if (error) return { error: error.message };

  revalidateContact(contactId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

const addressSchema = z.object({
  contactId: uuid,
  kind: z.enum(['email', 'phone']),
  value: z.string().trim().min(1, 'Enter an email address or a phone number'),
});

export async function addContactAddressAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = addressSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { contactId, kind, value } = parsed.data;

  const sb = createSupabaseServiceClient();
  // The function guards the tenant itself (it takes `p_company_id` and checks
  // membership), takes the advisory lock, and merges if the address turns out
  // to belong to another record of the same person.
  const { error } = await sb.rpc('contact_add_identity', {
    p_company_id: companyId,
    p_contact_id: contactId,
    p_kind: kind,
    p_value: value,
  });
  if (error) {
    return {
      error:
        kind === 'email'
          ? 'That does not look like an email address.'
          : 'That does not look like a phone number.',
    };
  }

  revalidateContact(contactId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Free-form details (the jsonb)
// ---------------------------------------------------------------------------

const attributeSchema = z.object({
  contactId: uuid,
  key: z.string().trim().min(1, 'Give the detail a name').max(60, 'That name is too long'),
  value: z.string().trim().max(500, 'That value is too long'),
});

/**
 * Read, merge, write.
 *
 * `jsonb_set` in a single statement would be tighter, but this is one agent
 * typing one detail on one screen — the write it could lose is another detail
 * the same person added in the same second, which does not happen. The company
 * filter is on both halves, so a contact id from another tenant reads nothing
 * and then writes nothing.
 */
export async function setContactAttributeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = attributeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { contactId, key, value } = parsed.data;

  const sb = createSupabaseServiceClient();
  const { data: current } = await sb
    .from('contacts')
    .select('attributes_json')
    .eq('company_id', companyId)
    .eq('id', contactId)
    .maybeSingle();
  if (!current) return { error: 'No such contact.' };

  const attributes = {
    ...((current as Record<string, unknown>).attributes_json as Record<string, unknown>),
    [key]: value,
  };

  const { error } = await sb
    .from('contacts')
    .update({ attributes_json: attributes })
    .eq('id', contactId)
    .eq('company_id', companyId);
  if (error) return { error: error.message };

  revalidateContact(contactId);
  return { ok: true };
}

const removeAttributeSchema = z.object({ contactId: uuid, key: z.string().min(1) });

/**
 * Void-returning, like `updateLeadStatusAction`: this is a one-click button in
 * a row, not a form with a result to report.
 */
export async function removeContactAttributeAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = removeAttributeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { contactId, key } = parsed.data;

  const sb = createSupabaseServiceClient();
  const { data: current } = await sb
    .from('contacts')
    .select('attributes_json')
    .eq('company_id', companyId)
    .eq('id', contactId)
    .maybeSingle();
  if (!current) return;

  const attributes = {
    ...((current as Record<string, unknown>).attributes_json as Record<string, unknown>),
  };
  delete attributes[key];

  await sb
    .from('contacts')
    .update({ attributes_json: attributes })
    .eq('id', contactId)
    .eq('company_id', companyId);

  revalidateContact(contactId);
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

const tagSchema = z.object({
  contactId: uuid,
  tag: z.string().trim().min(1, 'Type a tag first').max(40, 'That tag is too long'),
});

async function readTags(companyId: string, contactId: string): Promise<string[] | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('contacts')
    .select('tags')
    .eq('company_id', companyId)
    .eq('id', contactId)
    .maybeSingle();
  if (!data) return null;
  return ((data as Record<string, unknown>).tags as string[]) ?? [];
}

export async function addContactTagAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = tagSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { contactId } = parsed.data;
  // Tags are compared lowercased so "VIP" and "vip" cannot both exist and
  // filter to different sets of people.
  const tag = parsed.data.tag.toLowerCase();

  const tags = await readTags(companyId, contactId);
  if (tags === null) return { error: 'No such contact.' };
  if (tags.includes(tag)) return { ok: true };

  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('contacts')
    .update({ tags: [...tags, tag] })
    .eq('id', contactId)
    .eq('company_id', companyId);
  if (error) return { error: error.message };

  revalidateContact(contactId);
  return { ok: true };
}

export async function removeContactTagAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = tagSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { contactId, tag } = parsed.data;

  const tags = await readTags(companyId, contactId);
  if (tags === null) return;

  const sb = createSupabaseServiceClient();
  await sb
    .from('contacts')
    .update({ tags: tags.filter((t) => t !== tag) })
    .eq('id', contactId)
    .eq('company_id', companyId);

  revalidateContact(contactId);
}
