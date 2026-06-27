'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { ROLES } from '@/lib/constants';
import { hashInviteToken } from '@/lib/invites';

export type AcceptInviteState = { error?: string };

const schema = z.object({
  token: z.string().min(20),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function acceptAgentInviteAction(
  _prev: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const tokenHash = hashInviteToken(parsed.data.token);
  const sb = createSupabaseServiceClient();
  const { data: invite, error } = await sb
    .from('agent_invites')
    .select('id,company_id,email,full_name,expires_at,accepted_at,revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error || !invite) return { error: 'Invite link is invalid.' };
  if (invite.accepted_at) return { error: 'Invite already accepted.' };
  if (invite.revoked_at) return { error: 'Invite was revoked.' };
  if (new Date(invite.expires_at).getTime() < Date.now()) return { error: 'Invite has expired.' };

  const { data: created, error: createError } = await sb.auth.admin.createUser({
    email: invite.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: invite.full_name ?? null },
  });
  if (createError || !created?.user) return { error: createError?.message ?? 'Could not create agent user.' };

  const { error: linkError } = await sb.from('company_users').insert({
    company_id: invite.company_id,
    user_id: created.user.id,
    role: ROLES.AGENT,
  });
  if (linkError) return { error: linkError.message };

  await sb
    .from('agent_invites')
    .update({ accepted_at: new Date().toISOString(), accepted_user_id: created.user.id })
    .eq('id', invite.id);
  await sb.from('audit_logs').insert({
    company_id: invite.company_id,
    actor_user_id: created.user.id,
    action: 'agent.invite_accepted',
    target_type: 'agent_invite',
    target_id: invite.id,
    metadata_json: { email: invite.email },
  });

  redirect('/login');
}
