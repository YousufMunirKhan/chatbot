'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

const APPOINTMENT_STATUSES = ['requested', 'confirmed', 'cancelled', 'completed', 'no_show'] as const;

const setStatusSchema = z.object({
  appointmentId: z.string().uuid(),
  status: z.enum(APPOINTMENT_STATUSES),
});

export async function setAppointmentStatusAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = setStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();
  await sb
    .from('appointments')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.appointmentId)
    .eq('company_id', companyId); // scope guard
  revalidatePath('/company/appointments');
}
