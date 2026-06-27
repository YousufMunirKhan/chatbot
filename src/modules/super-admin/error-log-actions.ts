'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';

const resolveSchema = z.object({ id: z.string().uuid() });

export async function resolveErrorLogAction(formData: FormData): Promise<void> {
  const user = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = resolveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await createSupabaseServiceClient()
    .from('application_error_logs')
    .update({ resolved_at: new Date().toISOString(), resolved_by: user.userId })
    .eq('id', parsed.data.id);
  revalidatePath('/super-admin/error-logs');
}
