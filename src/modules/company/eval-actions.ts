'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export type ActionState = { error?: string; ok?: boolean };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

const addSchema = z.object({
  question: z.string().min(3, 'Question must be at least 3 characters'),
  botId: z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().uuid().optional()),
  language: z.enum(['en', 'ar']),
  expectedSource: optText,
});

export async function addEvalQuestionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const mustNotAnswer = formData.get('mustNotAnswer') === 'on';

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('eval_questions').insert({
    company_id: companyId,
    bot_id: v.botId ?? null,
    question: v.question,
    expected_source: v.expectedSource ?? null,
    language: v.language,
    must_not_answer_if_missing: mustNotAnswer,
  });
  if (error) return { error: error.message };

  revalidatePath('/company/quality');
  return { ok: true };
}
