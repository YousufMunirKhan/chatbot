'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

const schema = z.object({ status: z.enum(['online', 'away', 'offline']) });

export async function setAgentPresenceAction(formData: FormData): Promise<void> {
  const user = await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await createSupabaseServiceClient().from('agent_presence').upsert(
    {
      company_id: companyId,
      user_id: user.userId,
      status: parsed.data.status,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,company_id' },
  );
  revalidatePath('/company/agents');
  revalidatePath('/company/inbox');
}
