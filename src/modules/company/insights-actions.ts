'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { generateInsights } from '@/lib/ai/insights';
import { getCompanyId } from './data';

export type ActionState = { error?: string; ok?: boolean; message?: string };

const PATH = '/company/insights';

/**
 * Run the analysis on demand.
 *
 * Rate-limited to one run every ten minutes per company: the run reads several
 * thousand rows and makes a model call, and pressing the button twice tells the
 * owner nothing new.
 */
export async function generateInsightsAction(): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const { data: recent } = await sb
    .from('ai_insight_runs')
    .select('created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastAt = (recent as { created_at?: string } | null)?.created_at;
  if (lastAt && Date.now() - new Date(lastAt).getTime() < 10 * 60_000) {
    return { error: 'Already checked in the last ten minutes. New findings appear as new conversations come in.' };
  }

  const result = await generateInsights(companyId, 30);
  revalidatePath(PATH);

  if (result.status === 'failed') {
    return { error: result.note ?? 'The analysis could not finish. Try again shortly.' };
  }
  if (result.status === 'skipped') {
    return { ok: true, message: result.note ?? 'Not enough conversations yet.' };
  }
  return {
    ok: true,
    message:
      result.findings === 0
        ? 'Nothing worth flagging — the numbers all look healthy.'
        : `${result.findings} thing${result.findings === 1 ? '' : 's'} worth a look.`,
  };
}

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['new', 'acknowledged', 'done', 'dismissed']),
});

export async function setInsightStatusAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  const sb = createSupabaseServiceClient();
  await sb
    .from('ai_insights')
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('id', parsed.data.id);
  revalidatePath(PATH);
}
