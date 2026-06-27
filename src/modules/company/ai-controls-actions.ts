'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export type AiControlsState = { error?: string; ok?: boolean };

const schema = z.object({
  monthlyBudgetUsd: z.preprocess((x) => (x === '' || x == null ? undefined : x), z.coerce.number().nonnegative().optional()),
  hardStopEnabled: z.preprocess((x) => x === 'on', z.boolean()),
  cacheEnabled: z.preprocess((x) => x === 'on', z.boolean()),
});

export async function saveAiControlsAction(_prev: AiControlsState, formData: FormData): Promise<AiControlsState> {
  const user = await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const { error } = await createSupabaseServiceClient().from('company_ai_budgets').upsert(
    {
      company_id: companyId,
      monthly_budget_usd: v.monthlyBudgetUsd ?? null,
      hard_stop_enabled: v.hardStopEnabled,
      cache_enabled: v.cacheEnabled,
      updated_by: user.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id' },
  );
  if (error) return { error: error.message };
  revalidatePath('/company/ai-controls');
  return { ok: true };
}
