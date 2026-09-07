import { createSupabaseServiceClient } from '@/lib/db/server';

/**
 * Group membership helpers (migration 0057).
 *
 * Broadcasts, ticket routing and assignment all want to say "everyone in
 * Support" or "every VIP customer" without each of them re-deriving what that
 * means. These two functions are that shared answer.
 *
 * MULTI-TENANT ISOLATION: both take `companyId` and resolve the group *through*
 * it. The membership tables carry no `company_id` of their own (they inherit
 * the tenant from the group), so a caller that passed a group id straight to
 * the members table would happily read another tenant's group. Every read here
 * therefore confirms the group belongs to the company first and returns an
 * empty list when it does not — a caller can pass an attacker-supplied id and
 * get nothing rather than someone else's data.
 */

export type ContactType = 'lead' | 'synced_customer' | 'conversation';

export interface GroupContactRef {
  type: ContactType;
  id: string;
}

async function ownsGroup(table: string, companyId: string, groupId: string): Promise<boolean> {
  if (!companyId || !groupId) return false;
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from(table)
    .select('id')
    .eq('id', groupId)
    .eq('company_id', companyId)
    .maybeSingle();
  return Boolean(data);
}

/** User ids in a team group. Empty when the group is not this company's. */
export async function listGroupMemberIds(companyId: string, groupId: string): Promise<string[]> {
  if (!(await ownsGroup('agent_groups', companyId, groupId))) return [];
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('agent_group_members')
    .select('user_id')
    .eq('group_id', groupId);
  const ids = (data ?? []).map((row) => (row as { user_id: string }).user_id).filter(Boolean);
  return Array.from(new Set(ids));
}

/**
 * Contact ids in a contact group. Empty when the group is not this company's.
 *
 * `contactType` narrows the polymorphic membership to one kind of contact,
 * which is what a caller almost always wants: a WhatsApp broadcast can only
 * address leads, so asking for everything and filtering afterwards would make
 * "the group is empty" and "the group has nobody reachable" look identical.
 */
export async function contactIdsInGroup(
  companyId: string,
  groupId: string,
  contactType?: ContactType,
): Promise<string[]> {
  const refs = await contactRefsInGroup(companyId, groupId);
  const matching = contactType ? refs.filter((ref) => ref.type === contactType) : refs;
  return Array.from(new Set(matching.map((ref) => ref.id)));
}

/** Same read as `contactIdsInGroup`, keeping the contact kind alongside the id. */
export async function contactRefsInGroup(
  companyId: string,
  groupId: string,
): Promise<GroupContactRef[]> {
  if (!(await ownsGroup('contact_groups', companyId, groupId))) return [];
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('contact_group_members')
    .select('contact_type,contact_id')
    .eq('group_id', groupId);
  return (data ?? [])
    .map((row) => {
      const r = row as { contact_type: ContactType; contact_id: string };
      return { type: r.contact_type, id: r.contact_id };
    })
    .filter((ref) => Boolean(ref.id));
}
