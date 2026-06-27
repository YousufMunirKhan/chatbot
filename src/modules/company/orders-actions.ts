'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

const CHAT_ORDER_STATUSES = ['pending', 'confirmed', 'paid', 'fulfilled', 'cancelled'] as const;

const statusSchema = z.object({
  orderId: z.string().uuid(),
  status: z.enum(CHAT_ORDER_STATUSES),
});

export async function setChatOrderStatusAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();
  await sb
    .from('chat_orders')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.orderId)
    .eq('company_id', companyId); // scope guard
  revalidatePath('/company/orders');
}
