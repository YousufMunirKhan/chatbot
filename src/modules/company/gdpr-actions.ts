'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole, getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export type ActionState = { error?: string; ok?: boolean };

const processSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(['execute', 'reject']),
});

/**
 * Execute (or reject) a data-subject request. For a "delete" request this
 * actually erases the person's records — leads, appointments, and the
 * conversations linked to them (messages cascade) — scoped to this company,
 * matched by the requester's email. Every erasure is written to
 * data_erasure_logs for accountability.
 */
export async function processDataRequestAction(formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const user = await getSessionUser();
  const parsed = processSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid request' };
  const sb = createSupabaseServiceClient();

  const { data: reqRow } = await sb
    .from('data_subject_requests')
    .select('id,requester_email,request_type,status')
    .eq('company_id', companyId)
    .eq('id', parsed.data.requestId)
    .maybeSingle();
  if (!reqRow) return { error: 'Request not found' };
  const req = reqRow as { id: string; requester_email: string; request_type: string; status: string };
  if (req.status === 'completed' || req.status === 'rejected') {
    return { error: 'Request already processed' };
  }

  if (parsed.data.decision === 'reject') {
    await sb
      .from('data_subject_requests')
      .update({ status: 'rejected', completed_at: new Date().toISOString(), processed_by: user?.userId ?? null })
      .eq('company_id', companyId)
      .eq('id', req.id);
    revalidatePath('/company/settings');
    return { ok: true };
  }

  // EXPORT requests are fulfilled via the export endpoint; just mark complete.
  if (req.request_type === 'export') {
    await sb
      .from('data_subject_requests')
      .update({ status: 'completed', completed_at: new Date().toISOString(), processed_by: user?.userId ?? null })
      .eq('company_id', companyId)
      .eq('id', req.id);
    revalidatePath('/company/settings');
    return { ok: true };
  }

  // DELETE: erase the subject's data, counting what we remove.
  const email = req.requester_email;
  let conversationsDeleted = 0;
  let leadsDeleted = 0;
  let appointmentsDeleted = 0;

  // Conversations linked to this person's leads (messages cascade on delete).
  const { data: leadRows } = await sb
    .from('leads')
    .select('id,conversation_id')
    .eq('company_id', companyId)
    .eq('email', email);
  const convoIds = Array.from(
    new Set(
      (leadRows ?? [])
        .map((l) => (l as { conversation_id: string | null }).conversation_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (convoIds.length) {
    const { data: delConvos } = await sb
      .from('conversations')
      .delete()
      .eq('company_id', companyId)
      .in('id', convoIds)
      .select('id');
    conversationsDeleted = (delConvos ?? []).length;
  }

  const { data: delLeads } = await sb
    .from('leads')
    .delete()
    .eq('company_id', companyId)
    .eq('email', email)
    .select('id');
  leadsDeleted = (delLeads ?? []).length;

  const { data: delAppts } = await sb
    .from('appointments')
    .delete()
    .eq('company_id', companyId)
    .eq('customer_email', email)
    .select('id');
  appointmentsDeleted = (delAppts ?? []).length;

  await sb.from('data_erasure_logs').insert({
    company_id: companyId,
    request_id: req.id,
    requester_email: email,
    conversations_deleted: conversationsDeleted,
    leads_deleted: leadsDeleted,
    appointments_deleted: appointmentsDeleted,
    actor_user_id: user?.userId ?? null,
  });

  await sb
    .from('data_subject_requests')
    .update({ status: 'completed', completed_at: new Date().toISOString(), processed_by: user?.userId ?? null })
    .eq('company_id', companyId)
    .eq('id', req.id);

  revalidatePath('/company/settings');
  return { ok: true };
}
