'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { logSecurityEvent } from '@/lib/security';
import { getCompanyId } from './data';

export async function setTwoFactorEnabledAction(formData: FormData): Promise<void> {
  const user = await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const enabled = formData.get('enabled') === 'on';
  const sb = createSupabaseServiceClient();
  await sb.from('user_security_settings').upsert(
    {
      user_id: user.userId,
      two_factor_enabled: enabled,
      two_factor_method: 'email',
      two_factor_verified_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  await logSecurityEvent({
    userId: user.userId,
    companyId,
    eventType: enabled ? '2fa.enabled' : '2fa.disabled',
  });
  revalidatePath('/company/security');
}
