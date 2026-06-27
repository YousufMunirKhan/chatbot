'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export type WidgetDesignActionState = { error?: string; ok?: boolean };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());
const optNum = z.preprocess(
  (x) => (x === '' || x == null ? undefined : x),
  z.coerce.number().int().optional(),
);
const optColor = z.preprocess(
  (x) => (x === '' || x == null ? undefined : x),
  z.string().regex(/^#[0-9a-f]{6}$/i, 'Choose a valid color').optional(),
);

const schema = z.object({
  botId: z.string().uuid(),
  title: optText,
  welcomeMessage: optText,
  proactiveMessage: optText,
  agentLabel: optText,
  agentAvatarUrl: optText,
  avatarMode: z.enum(['initials', 'image', 'headset', 'chat', 'spark']).default('initials'),
  launcherIcon: z.enum(['chat', 'headset', 'spark', 'help', 'question', 'initials', 'custom']).default('chat'),
  launcherImageUrl: optText,
  launcherLabel: optText,
  launcherDotMode: z.enum(['unread', 'always', 'hidden']).default('unread'),
  launcherDotColor: optColor,
  onlineLabel: optText,
  offlineLabel: optText,
  typingLabel: optText,
  footerBranding: optText,
  primaryColor: optColor,
  headerTextColor: optColor,
  headerStyle: z.enum(['solid', 'gradient']).default('solid'),
  launcherStyle: z.enum(['circle', 'pill']).default('pill'),
  launcherSize: z.enum(['compact', 'default', 'large']).default('default'),
  windowSize: z.enum(['compact', 'default', 'large']).default('default'),
  mobileMode: z.enum(['fullscreen', 'bottom_sheet']).default('fullscreen'),
  position: z.enum(['left', 'right']).default('right'),
  autoOpen: z.preprocess((x) => x === 'on', z.boolean()),
  autoOpenOnce: z.preprocess((x) => x === 'on', z.boolean()),
  autoOpenDelaySeconds: optNum,
  showOnMobile: z.preprocess((x) => x === 'on', z.boolean()),
  showOnDesktop: z.preprocess((x) => x === 'on', z.boolean()),
  bottomOffset: optNum,
  sideOffset: optNum,
});

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function textOrNull(value: string | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

export async function updateWidgetDesignAction(
  _prev: WidgetDesignActionState,
  formData: FormData,
): Promise<WidgetDesignActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid widget design' };
  const v = parsed.data;

  const sb = createSupabaseServiceClient();
  const { data: bot, error: readError } = await sb
    .from('bots')
    .select('id,name,appearance_json')
    .eq('company_id', companyId)
    .eq('id', v.botId)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!bot) return { error: 'Assistant not found.' };

  const previous = ((bot as Record<string, unknown>).appearance_json as Record<string, unknown> | null) ?? {};
  const next = {
    ...previous,
    title: textOrNull(v.title) ?? (bot.name as string),
    welcomeMessage: textOrNull(v.welcomeMessage),
    proactiveMessage: textOrNull(v.proactiveMessage),
    agentLabel: textOrNull(v.agentLabel) ?? 'Team',
    agentAvatarUrl: textOrNull(v.agentAvatarUrl),
    avatarMode: v.avatarMode,
    launcherIcon: v.launcherIcon,
    launcherImageUrl: textOrNull(v.launcherImageUrl),
    launcherLabel: textOrNull(v.launcherLabel),
    launcherDotMode: v.launcherDotMode,
    launcherDotColor: v.launcherDotColor ?? '#ef4444',
    onlineLabel: textOrNull(v.onlineLabel) ?? 'Team is replying - live',
    offlineLabel: textOrNull(v.offlineLabel) ?? 'Replying soon',
    typingLabel: textOrNull(v.typingLabel) ?? 'Team is typing',
    footerBranding: textOrNull(v.footerBranding),
    primaryColor: v.primaryColor ?? '#045fff',
    headerTextColor: v.headerTextColor ?? '#ffffff',
    headerStyle: v.headerStyle,
    launcherStyle: v.launcherStyle,
    launcherSize: v.launcherSize,
    windowSize: v.windowSize,
    mobileMode: v.mobileMode,
    position: v.position,
    autoOpen: v.autoOpen,
    autoOpenOnce: v.autoOpenOnce,
    autoOpenDelaySeconds: clamp(v.autoOpenDelaySeconds, 3, 0, 120),
    showOnMobile: v.showOnMobile,
    showOnDesktop: v.showOnDesktop,
    bottomOffset: clamp(v.bottomOffset, 20, 0, 120),
    sideOffset: clamp(v.sideOffset, 20, 0, 120),
    widgetVersion: Date.now(),
  };

  const { error } = await sb
    .from('bots')
    .update({ appearance_json: next })
    .eq('company_id', companyId)
    .eq('id', v.botId);
  if (error) return { error: error.message };

  revalidatePath('/company/widget');
  revalidatePath(`/company/bots/${v.botId}/settings`);
  return { ok: true };
}
