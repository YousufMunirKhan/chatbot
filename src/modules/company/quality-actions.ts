'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { ingestText } from '@/lib/ai/ingest';
import { getCompanyId } from './data';
import { recomputeCompanyBotPrompts } from './prompt';

export type QualityActionState = { error?: string; ok?: boolean };

const schema = z.object({
  qualityLogId: z.string().uuid(),
  rating: z.enum(['good', 'bad', 'missing_info', 'wrong_answer', 'too_slow', 'needs_human']).default('missing_info'),
  fixType: z.enum(['knowledge', 'faq', 'policy', 'service', 'profile', 'prompt']).default('knowledge'),
  correctionText: z.string().min(20, 'Add at least 20 characters for the corrected knowledge.').max(50000),
  createKnowledge: z.preprocess((x) => x === 'on', z.boolean()),
});

export async function saveQualityFeedbackAction(
  _prev: QualityActionState,
  formData: FormData,
): Promise<QualityActionState> {
  const user = await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();
  const { data: log } = await sb
    .from('answer_quality_logs')
    .select('id,question,bot_id')
    .eq('company_id', companyId)
    .eq('id', v.qualityLogId)
    .maybeSingle();
  if (!log) return { error: 'Quality log not found.' };

  let documentId: string | null = null;
  let chunksCreated = 0;
  let structuredType: string | null = null;
  let structuredId: string | null = null;
  let editHref = '/company/knowledge';
  if (v.createKnowledge) {
    const question = String(log.question ?? '').trim() || 'Customer question';
    if (v.fixType === 'faq') {
      const doc = await ingestText({
        companyId,
        botId: (log.bot_id as string | null) ?? null,
        title: `FAQ: ${question.slice(0, 80)}`,
        text: `Question: ${question}\nTopic: general\nAnswer: ${v.correctionText}`,
        sourceType: 'faq',
      });
      documentId = doc.documentId;
      chunksCreated = doc.chunks;
      const { data, error: faqError } = await sb
        .from('company_faqs')
        .insert({
          company_id: companyId,
          bot_id: (log.bot_id as string | null) ?? null,
          question,
          answer: v.correctionText,
          category: 'general',
          document_id: documentId,
        })
        .select('id')
        .single();
      if (faqError) return { error: faqError.message };
      structuredType = 'faq';
      structuredId = data.id as string;
      editHref = '/company/profile#faqs';
    } else if (v.fixType === 'policy') {
      const title = question.slice(0, 80);
      const doc = await ingestText({
        companyId,
        botId: (log.bot_id as string | null) ?? null,
        title: `Policy: ${title}`,
        text: `${title}\nCategory: general\n\n${v.correctionText}`,
        sourceType: 'text',
      });
      documentId = doc.documentId;
      chunksCreated = doc.chunks;
      const { data, error: policyError } = await sb
        .from('company_policies')
        .insert({
          company_id: companyId,
          bot_id: (log.bot_id as string | null) ?? null,
          title,
          category: 'general',
          content: v.correctionText,
          document_id: documentId,
        })
        .select('id')
        .single();
      if (policyError) return { error: policyError.message };
      structuredType = 'policy';
      structuredId = data.id as string;
      editHref = '/company/profile#policies';
    } else if (v.fixType === 'service') {
      const { data: profile } = await sb
        .from('company_business_profiles')
        .select('default_currency')
        .eq('company_id', companyId)
        .maybeSingle();
      const { data, error: serviceError } = await sb
        .from('company_services')
        .insert({
          company_id: companyId,
          name: question.slice(0, 80),
          category: 'service',
          description: v.correctionText,
          currency: (profile?.default_currency as string | undefined) ?? 'USD',
        })
        .select('id')
        .single();
      if (serviceError) return { error: serviceError.message };
      structuredType = 'service';
      structuredId = data.id as string;
      editHref = '/company/profile#services';
    } else {
      const titlePrefix: Record<typeof v.fixType, string> = {
        knowledge: 'Quality fix',
        profile: 'Business profile fix',
        prompt: 'Assistant instruction fix',
      };
      const title = `${titlePrefix[v.fixType]}: ${question.slice(0, 80)}`;
      const doc = await ingestText({
        companyId,
        botId: (log.bot_id as string | null) ?? null,
        title,
        text: `Customer question:\n${question}\n\nFix type:\n${v.fixType}\n\nCorrect answer / business info:\n${v.correctionText}`,
        sourceType: 'text',
      });
      documentId = doc.documentId;
      chunksCreated = doc.chunks;
      structuredType = 'knowledge';
      structuredId = documentId;
    }
  }

  const { error } = await sb.from('answer_quality_feedback').upsert(
    {
      company_id: companyId,
      quality_log_id: v.qualityLogId,
      status: 'fixed',
      rating: v.rating,
      correction_text: v.correctionText,
      created_document_id: documentId,
      created_by: user.userId,
      metadata_json: { fixType: v.fixType, chunksCreated, structuredType, structuredId, editHref },
      resolved_at: new Date().toISOString(),
    },
    { onConflict: 'quality_log_id' },
  );
  if (error) return { error: error.message };
  if (structuredType) await recomputeCompanyBotPrompts(sb, companyId);
  revalidatePath('/company/quality');
  revalidatePath('/company/knowledge');
  revalidatePath('/company/profile');
  return { ok: true };
}
