'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { sendPushToUser } from '@/lib/push';
import { isPushConfigured } from '@/lib/push/vapid';
import { getCompanyId } from './data';

/** Matches `FormMessage`'s structural state, with the success copy alongside. */
export type PushActionState = { error?: string; ok?: boolean; okText?: string };

/**
 * "Send test notification" — the only honest way to tell an agent whether the
 * whole chain works. Permission can be granted, the subscription stored, and
 * delivery still fail at the push service (an expired VAPID subject, a locked
 * corporate profile). Sending to the CURRENT USER's devices only, so the button
 * can never be used to buzz the rest of the company.
 */
export async function sendTestPushAction(
  _prev: PushActionState,
  _formData: FormData,
): Promise<PushActionState> {
  const user = await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  await getCompanyId(); // company scope guard — throws/redirects if none

  if (!isPushConfigured()) {
    return { error: 'Phone alerts are not switched on for this platform yet. Ask your administrator to add the VAPID keys.' };
  }

  const result = await sendPushToUser(user.userId, {
    title: 'Test alert',
    body: 'Phone alerts are working. This is what a new lead or handoff will look like.',
    url: '/company/notifications',
    tag: 'push-test',
    type: 'push_test',
  });

  if (result.attempted === 0) {
    return { error: 'No device is registered yet. Turn phone alerts on first, then try again.' };
  }
  if (result.delivered === 0) {
    return {
      error:
        result.pruned > 0
          ? 'That device is no longer registered with the push service, so it has been removed. Turn phone alerts on again.'
          : 'The push service refused the message. Check the delivery log and try again.',
    };
  }

  revalidatePath('/company/notifications');
  return { ok: true, okText: `Sent to ${result.delivered} device${result.delivered === 1 ? '' : 's'}.` };
}

const forgetSchema = z.object({ subscriptionId: z.string().uuid() });

/** Remove one of your own devices from the dashboard, without needing the phone. */
export async function forgetPushDeviceAction(formData: FormData): Promise<void> {
  const user = await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = forgetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  const sb = createSupabaseServiceClient();
  await sb
    .from('push_subscriptions')
    .delete()
    .eq('id', parsed.data.subscriptionId)
    .eq('user_id', user.userId) // your own devices only
    .eq('company_id', companyId); // scope guard

  revalidatePath('/company/notifications');
}
