'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

/**
 * Team-group and contact-group management (migration 0057).
 *
 * MULTI-TENANT ISOLATION: the membership tables (`agent_group_members`,
 * `contact_group_members`) have no `company_id`, so every write that names a
 * group id calls `assertOwnsGroup()` first. Without that, a company admin could
 * post another tenant's group id and add themselves to it. The group tables
 * themselves are always written with `.eq('company_id', companyId)`.
 */

export type ActionState = { error?: string; ok?: boolean };

const GROUP_TABLES = { team: 'agent_groups', contact: 'contact_groups' } as const;
type GroupKind = keyof typeof GROUP_TABLES;

async function assertOwnsGroup(kind: GroupKind, groupId: string): Promise<string | null> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from(GROUP_TABLES[kind])
    .select('id')
    .eq('id', groupId)
    .eq('company_id', companyId)
    .maybeSingle();
  return data ? companyId : null;
}

function done(): void {
  revalidatePath('/company/groups');
}

// --- create -----------------------------------------------------------------

const createSchema = z.object({
  kind: z.enum(['team', 'contact']),
  name: z.string().min(1, 'Name is required').max(80),
  description: z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().max(300).optional()),
  colour: z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().max(20).optional()),
});

export async function createGroupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid group' };
  const v = parsed.data;

  const sb = createSupabaseServiceClient();
  // The two group tables differ by one column, so the payload is built as a
  // record rather than a union — postgrest-js infers the insert shape from the
  // first branch otherwise and rejects the second.
  const payload: Record<string, unknown> =
    v.kind === 'team'
      ? { company_id: companyId, name: v.name, description: v.description ?? null }
      : { company_id: companyId, name: v.name, colour: v.colour ?? null };

  const { error } = await sb.from(GROUP_TABLES[v.kind]).insert(payload);
  if (error) {
    return {
      error: error.message.includes('duplicate')
        ? 'You already have a group with that name.'
        : error.message,
    };
  }
  done();
  return { ok: true };
}

// --- rename / delete --------------------------------------------------------

const renameSchema = z.object({
  kind: z.enum(['team', 'contact']),
  groupId: z.string().uuid(),
  name: z.string().min(1).max(80),
});

export async function renameGroupAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = renameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const companyId = await assertOwnsGroup(parsed.data.kind, parsed.data.groupId);
  if (!companyId) return;
  const sb = createSupabaseServiceClient();
  await sb
    .from(GROUP_TABLES[parsed.data.kind])
    .update({ name: parsed.data.name })
    .eq('id', parsed.data.groupId)
    .eq('company_id', companyId);
  done();
}

const groupRefSchema = z.object({
  kind: z.enum(['team', 'contact']),
  groupId: z.string().uuid(),
});

export async function deleteGroupAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = groupRefSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const companyId = await assertOwnsGroup(parsed.data.kind, parsed.data.groupId);
  if (!companyId) return;
  const sb = createSupabaseServiceClient();
  // Members go with the group via `on delete cascade` in migration 0057.
  await sb
    .from(GROUP_TABLES[parsed.data.kind])
    .delete()
    .eq('id', parsed.data.groupId)
    .eq('company_id', companyId);
  done();
}

// --- team membership --------------------------------------------------------

const teamMemberSchema = z.object({
  groupId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function addTeamMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = teamMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Pick a teammate to add.' };
  const companyId = await assertOwnsGroup('team', parsed.data.groupId);
  if (!companyId) return { error: 'Group not found.' };

  const sb = createSupabaseServiceClient();
  // ISOLATION: only a member of THIS company may be added, or the group would
  // become a way to name users from another tenant.
  const { data: member } = await sb
    .from('company_users')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('user_id', parsed.data.userId)
    .maybeSingle();
  if (!member) return { error: 'That person is not on your team.' };

  const { error } = await sb
    .from('agent_group_members')
    .upsert(
      { group_id: parsed.data.groupId, user_id: parsed.data.userId },
      { onConflict: 'group_id,user_id' },
    );
  if (error) return { error: error.message };
  done();
  return { ok: true };
}

export async function removeTeamMemberAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = teamMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  if (!(await assertOwnsGroup('team', parsed.data.groupId))) return;
  const sb = createSupabaseServiceClient();
  await sb
    .from('agent_group_members')
    .delete()
    .eq('group_id', parsed.data.groupId)
    .eq('user_id', parsed.data.userId);
  done();
}

// --- contact membership -----------------------------------------------------

const contactMemberSchema = z.object({
  groupId: z.string().uuid(),
  contactType: z.enum(['lead', 'synced_customer', 'conversation']).default('lead'),
  contactId: z.string().uuid(),
});

const CONTACT_TABLES: Record<'lead' | 'synced_customer' | 'conversation', string> = {
  lead: 'leads',
  synced_customer: 'synced_customers',
  conversation: 'conversations',
};

export async function addContactMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = contactMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Pick a contact to add.' };
  const companyId = await assertOwnsGroup('contact', parsed.data.groupId);
  if (!companyId) return { error: 'Group not found.' };

  const sb = createSupabaseServiceClient();
  // ISOLATION: `contact_group_members` has no FK (the contact is polymorphic),
  // so this is the only thing stopping another tenant's lead id being stored.
  const { data: contact } = await sb
    .from(CONTACT_TABLES[parsed.data.contactType])
    .select('id')
    .eq('id', parsed.data.contactId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!contact) return { error: 'That contact was not found in your account.' };

  const { error } = await sb.from('contact_group_members').upsert(
    {
      group_id: parsed.data.groupId,
      contact_type: parsed.data.contactType,
      contact_id: parsed.data.contactId,
    },
    { onConflict: 'group_id,contact_type,contact_id' },
  );
  if (error) return { error: error.message };
  done();
  return { ok: true };
}

export async function removeContactMemberAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const parsed = contactMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  if (!(await assertOwnsGroup('contact', parsed.data.groupId))) return;
  const sb = createSupabaseServiceClient();
  await sb
    .from('contact_group_members')
    .delete()
    .eq('group_id', parsed.data.groupId)
    .eq('contact_type', parsed.data.contactType)
    .eq('contact_id', parsed.data.contactId);
  done();
}
