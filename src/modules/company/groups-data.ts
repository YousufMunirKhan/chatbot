import { createSupabaseServiceClient } from '@/lib/db/server';
import type { ContactType } from '@/lib/groups';
import { getCompanyId } from './data';

/**
 * Team groups and contact groups (migration 0057).
 *
 * Every read is bound to the SESSION company via `getCompanyId()`. The
 * membership tables carry no `company_id` of their own, so they are always read
 * through the group ids this company owns rather than by a caller-supplied id.
 */

export interface AgentGroupRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  members: Array<{ userId: string; email: string | null; role: string | null }>;
}

export interface ContactGroupRow {
  id: string;
  name: string;
  colour: string | null;
  createdAt: string;
  members: Array<{ type: ContactType; id: string; label: string }>;
}

export interface TeamMemberOption {
  userId: string;
  email: string;
  role: string;
}

/** Everyone in the company, for the "add a member" picker. */
export async function listTeamMemberOptions(): Promise<TeamMemberOption[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_users')
    .select('user_id,role, users(email)')
    .eq('company_id', companyId)
    .limit(500);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const embedded = r.users as { email?: string } | { email?: string }[] | null;
    const user = Array.isArray(embedded) ? (embedded[0] ?? null) : embedded;
    return {
      userId: r.user_id as string,
      email: user?.email ?? '(no email)',
      role: (r.role as string) ?? 'agent',
    };
  });
}

export async function listAgentGroups(): Promise<AgentGroupRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data: groups } = await sb
    .from('agent_groups')
    .select('id,name,description,created_at')
    .eq('company_id', companyId)
    .order('name', { ascending: true })
    .limit(200);

  const rows = (groups ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const { data: members } = await sb
    .from('agent_group_members')
    .select('group_id,user_id, users(email)')
    .in(
      'group_id',
      rows.map((g) => g.id as string),
    )
    .limit(2000);

  const byGroup = new Map<string, AgentGroupRow['members']>();
  for (const m of (members ?? []) as Array<Record<string, unknown>>) {
    const embedded = m.users as { email?: string } | { email?: string }[] | null;
    const user = Array.isArray(embedded) ? (embedded[0] ?? null) : embedded;
    const list = byGroup.get(m.group_id as string) ?? [];
    list.push({ userId: m.user_id as string, email: user?.email ?? null, role: null });
    byGroup.set(m.group_id as string, list);
  }

  return rows.map((g) => ({
    id: g.id as string,
    name: g.name as string,
    description: (g.description as string) ?? null,
    createdAt: g.created_at as string,
    members: byGroup.get(g.id as string) ?? [],
  }));
}

export async function listContactGroups(): Promise<ContactGroupRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data: groups } = await sb
    .from('contact_groups')
    .select('id,name,colour,created_at')
    .eq('company_id', companyId)
    .order('name', { ascending: true })
    .limit(200);

  const rows = (groups ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const { data: members } = await sb
    .from('contact_group_members')
    .select('group_id,contact_type,contact_id')
    .in(
      'group_id',
      rows.map((g) => g.id as string),
    )
    .limit(5000);

  const memberRows = (members ?? []) as Array<{
    group_id: string;
    contact_type: ContactType;
    contact_id: string;
  }>;

  // Resolve lead ids to names in one query so the list reads as people rather
  // than as uuids. Other contact kinds fall back to a short id.
  const leadIds = memberRows.filter((m) => m.contact_type === 'lead').map((m) => m.contact_id);
  const leadNames = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leads } = await sb
      .from('leads')
      .select('id,name,phone,email')
      .eq('company_id', companyId)
      .in('id', leadIds.slice(0, 1000));
    for (const lead of (leads ?? []) as Array<Record<string, unknown>>) {
      leadNames.set(
        lead.id as string,
        (lead.name as string) || (lead.phone as string) || (lead.email as string) || 'Lead',
      );
    }
  }

  const byGroup = new Map<string, ContactGroupRow['members']>();
  for (const m of memberRows) {
    const list = byGroup.get(m.group_id) ?? [];
    list.push({
      type: m.contact_type,
      id: m.contact_id,
      label: leadNames.get(m.contact_id) ?? `${m.contact_type} ${m.contact_id.slice(0, 8)}`,
    });
    byGroup.set(m.group_id, list);
  }

  return rows.map((g) => ({
    id: g.id as string,
    name: g.name as string,
    colour: (g.colour as string) ?? null,
    createdAt: g.created_at as string,
    members: byGroup.get(g.id as string) ?? [],
  }));
}

/** Recent leads, for the "add a contact" picker. */
export async function listLeadOptions(): Promise<Array<{ id: string; label: string }>> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('leads')
    .select('id,name,phone,email,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(200);
  return ((data ?? []) as Array<Record<string, unknown>>).map((l) => ({
    id: l.id as string,
    label: ((l.name as string) || (l.phone as string) || (l.email as string) || 'Lead') as string,
  }));
}
