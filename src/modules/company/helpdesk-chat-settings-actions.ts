'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { normalizeList } from '@/lib/quick-actions';
import { getCompanyId } from './data';
import type { ActionState } from './actions';

const schema = z.object({
  enabled: z.preprocess((x) => x === 'on', z.boolean()),
  showMode: z.enum(['floating', 'embedded', 'hidden']).default('floating'),
  allowedRoles: z.string().optional(),
  allowedRoutes: z.string().optional(),
  blockedRoutes: z.string().optional(),
  autoOpen: z.preprocess((x) => x === 'on', z.boolean()),
  position: z.enum(['left', 'right']).default('right'),
});

export async function saveHelpdeskChatSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid settings' };
  const value = parsed.data;

  const { error } = await createSupabaseServiceClient().from('helpdesk_chat_settings').upsert({
    company_id: companyId,
    enabled: value.enabled,
    show_mode: value.showMode,
    allowed_roles: normalizeList(value.allowedRoles),
    allowed_routes: normalizeList(value.allowedRoutes),
    blocked_routes: normalizeList(value.blockedRoutes),
    auto_open: value.autoOpen,
    position: value.position,
  });
  if (error) return { error: error.message };
  revalidatePath('/company/help-desk');
  return { ok: true };
}
