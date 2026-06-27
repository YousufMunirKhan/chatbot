'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export async function markAllReadAction(_formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  await sb
    .from('notifications')
    .update({ read: true })
    .eq('company_id', companyId)
    .eq('read', false);
  revalidatePath('/company/notifications');
}

const markReadSchema = z.object({ notificationId: z.string().uuid() });

export async function markReadAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = markReadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();
  await sb
    .from('notifications')
    .update({ read: true })
    .eq('id', parsed.data.notificationId)
    .eq('company_id', companyId); // scope guard
  revalidatePath('/company/notifications');
}
