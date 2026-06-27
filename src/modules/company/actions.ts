'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ASSISTANT_AUDIENCES, ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { BOT_CAPABILITIES, BOT_TYPES } from '@/lib/constants';
import { getCompanyId } from './data';
import { recomputeBotPrompt, recomputeCompanyBotPrompts } from './prompt';
import { assertWithinPlan } from '@/lib/billing';
import { createInviteToken, hashInviteToken } from '@/lib/invites';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';
import { requestConnectorResync } from '@/lib/helpdesk/connectors';
import { seedDefaultQuickActions } from '@/lib/quick-actions-defaults';

export type ActionState = { error?: string; ok?: boolean };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());
const optNum = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.coerce.number().int().optional());
const optColor = z.preprocess(
  (x) => (x === '' || x == null ? undefined : x),
  z.string().regex(/^#[0-9a-f]{6}$/i, 'Choose a valid color').optional(),
);

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function textOr(value: string | undefined, fallback: string): string {
  return value?.trim() ? value : fallback;
}

function appearanceDefaults(audience: 'customer' | 'internal', botName: string) {
  if (audience === 'internal') {
    return {
      title: botName || 'Internal Help Desk',
      welcomeMessage:
        'Hi, I can guide your team through project notes, stock, orders, customers, and safe updates.',
      agentLabel: 'Help Desk',
      onlineLabel: 'Ready for staff questions',
      offlineLabel: 'Available when your team needs help',
      typingLabel: 'Checking internal knowledge',
      footerBranding: 'Internal assistant. Check important actions before applying changes.',
      proactiveMessage: 'Ask me how this project works or where to update something.',
      primaryColor: '#2563eb',
    };
  }

  return {
    title: botName || 'Website Assistant',
    welcomeMessage:
      'Hi, I can help with services, pricing, appointments, orders, and support. What would you like to sort out today?',
    agentLabel: 'Team',
    onlineLabel: 'Team is replying - live',
    offlineLabel: 'Replying soon',
    typingLabel: 'Team is typing',
    footerBranding:
      'AI assistant may be inaccurate. We may use messages and contact details to respond to your enquiry.',
    proactiveMessage: 'Need help choosing the right option? I can guide you in under a minute.',
    primaryColor: '#045fff',
  };
}

function domainListToArray(v: FormDataEntryValue | null): string[] {
  if (typeof v !== 'string' || !v.trim()) return [];
  const domains = v
    .split(/[\n\r,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((domain) => {
      try {
        return new URL(domain.includes('://') ? domain : `https://${domain}`).hostname;
      } catch {
        return domain.replace(/^https?:\/\//, '').split('/')[0] ?? domain;
      }
    })
    .map((domain) => domain.replace(/^www\./, 'www.'))
    .filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain));
  return Array.from(new Set(domains)).slice(0, 20);
}

// ---------------------------------------------------------------------------
// Business profile
// ---------------------------------------------------------------------------
const profileSchema = z.object({
  name: z.string().min(2, 'Company name is required'),
  website: z.preprocess((x) => (x === '' ? undefined : x), z.string().url().optional()),
  country: optText,
  timezone: optText,
  defaultLanguage: z.enum(['en', 'ar', 'auto']),
});

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('companies')
    .update({
      name: v.name,
      website: v.website ?? null,
      country: v.country ?? null,
      timezone: v.timezone ?? null,
      default_language: v.defaultLanguage,
    })
    .eq('id', companyId);
  if (error) return { error: error.message };
  await recomputeCompanyBotPrompts(sb, companyId);
  revalidatePath('/company/profile');
  revalidatePath('/company/business-data');
  revalidatePath('/company/setup');
  revalidatePath('/company');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Assistants (create / update). Deeper prompt assembly is Module 6.
// ---------------------------------------------------------------------------
const botBaseSchema = z.object({
  name: z.string().min(2, 'Assistant name is required'),
  assistantAudience: z.enum(ASSISTANT_AUDIENCES).default('customer'),
  botType: z.enum(BOT_TYPES),
  languageDefault: z.enum(['en', 'ar', 'auto']),
  welcomeMessage: optText,
  title: optText,
  agentLabel: optText,
  agentAvatarUrl: optText,
  avatarMode: z.enum(['initials', 'image', 'headset', 'chat', 'spark']).default('initials'),
  launcherIcon: z.enum(['chat', 'headset', 'spark', 'help', 'question', 'initials', 'custom']).default('chat'),
  launcherImageUrl: optText,
  launcherLabel: optText,
  launcherDotMode: z.enum(['unread', 'always', 'hidden']).default('unread'),
  launcherDotColor: optColor,
  headerTextColor: optColor,
  headerStyle: z.enum(['solid', 'gradient']).default('solid'),
  onlineLabel: optText,
  offlineLabel: optText,
  typingLabel: optText,
  footerBranding: optText,
  proactiveMessage: optText,
  autoOpen: z.preprocess((x) => x === 'on', z.boolean()),
  autoOpenOnce: z.preprocess((x) => x === 'on', z.boolean()),
  autoOpenDelaySeconds: optNum,
  launcherStyle: z.enum(['circle', 'pill']).default('pill'),
  launcherSize: z.enum(['compact', 'default', 'large']).default('default'),
  windowSize: z.enum(['compact', 'default', 'large']).default('default'),
  mobileMode: z.enum(['fullscreen', 'bottom_sheet']).default('fullscreen'),
  showOnMobile: z.preprocess((x) => x === 'on', z.boolean()),
  showOnDesktop: z.preprocess((x) => x === 'on', z.boolean()),
  bottomOffset: optNum,
  sideOffset: optNum,
  zIndex: optNum,
  primaryColor: optColor,
  position: z.enum(['left', 'right']).default('right'),
});

function readBotFields(formData: FormData) {
  const parsed = botBaseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' } as const;
  const capabilities = formData
    .getAll('capabilities')
    .map((c) => String(c))
    .filter((c) => (BOT_CAPABILITIES as readonly string[]).includes(c));
  const domainAllowlist = domainListToArray(formData.get('domainAllowlist'));
  const v = parsed.data;
  const defaults = appearanceDefaults(v.assistantAudience, v.name);
  return {
    value: {
      name: v.name,
      bot_type: v.botType,
      language_default: v.languageDefault,
      capability_flags: capabilities,
      domain_allowlist: domainAllowlist,
      appearance_json: {
        assistantAudience: v.assistantAudience,
        title: textOr(v.title, defaults.title),
        welcomeMessage: textOr(v.welcomeMessage, defaults.welcomeMessage),
        agentLabel: textOr(v.agentLabel, defaults.agentLabel),
        agentAvatarUrl: v.agentAvatarUrl ?? null,
        avatarMode: v.avatarMode,
        launcherIcon: v.launcherIcon,
        launcherImageUrl: v.launcherImageUrl ?? null,
        launcherLabel: v.launcherLabel ?? null,
        launcherDotMode: v.launcherDotMode,
        launcherDotColor: v.launcherDotColor ?? '#ef4444',
        headerTextColor: v.headerTextColor ?? '#ffffff',
        headerStyle: v.headerStyle,
        onlineLabel: textOr(v.onlineLabel, defaults.onlineLabel),
        offlineLabel: textOr(v.offlineLabel, defaults.offlineLabel),
        typingLabel: textOr(v.typingLabel, defaults.typingLabel),
        footerBranding: textOr(v.footerBranding, defaults.footerBranding),
        proactiveMessage: textOr(v.proactiveMessage, defaults.proactiveMessage),
        autoOpen: v.autoOpen,
        autoOpenOnce: v.autoOpenOnce,
        autoOpenDelaySeconds: clamp(v.autoOpenDelaySeconds, 3, 0, 120),
        launcherStyle: v.launcherStyle,
        launcherSize: v.launcherSize,
        windowSize: v.windowSize,
        mobileMode: v.mobileMode,
        showOnMobile: v.showOnMobile,
        showOnDesktop: v.showOnDesktop,
        bottomOffset: clamp(v.bottomOffset, 20, 0, 120),
        sideOffset: clamp(v.sideOffset, 20, 0, 120),
        zIndex: clamp(v.zIndex, 2147483000, 1000, 2147483000),
        primaryColor: v.primaryColor ?? defaults.primaryColor,
        position: v.position,
      },
    },
  } as const;
}

function isHelpdeskBot(value: { bot_type?: unknown; capability_flags?: unknown }): boolean {
  return (
    value.bot_type === 'help_desk' ||
    (Array.isArray(value.capability_flags) && value.capability_flags.includes('help_desk'))
  );
}

async function requestHelpdeskConnectorResync(companyId: string, reason: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('helpdesk_connectors')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'active');

  await Promise.all(
    (data ?? []).map((connector) =>
      requestConnectorResync({
        companyId,
        connectorId: connector.id as string,
        reason,
      }),
    ),
  );
}

export async function createBotAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const fields = readBotFields(formData);
  if ('error' in fields) return { error: fields.error };
  const sb = createSupabaseServiceClient();

  // Enforce the plan's bot limit if set.
  const { data: sub } = await sb.from('subscriptions').select('bot_limit').eq('company_id', companyId).maybeSingle();
  const botLimit = (sub as { bot_limit?: number } | null)?.bot_limit ?? null;
  if (botLimit != null) {
    const { count } = await sb
      .from('bots')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);
    if ((count ?? 0) >= botLimit) {
      return { error: `Your plan allows up to ${botLimit} assistant(s). Upgrade to add more.` };
    }
  }

  const { data: bot, error } = await sb
    .from('bots')
    .insert({ company_id: companyId, ...fields.value })
    .select('id')
    .single();
  if (error || !bot) return { error: error?.message ?? 'Could not create assistant' };

  // Seed editable default in-chat quick actions (lead / appointment / handoff)
  // for the enabled capabilities so forms work in the widget out of the box.
  await seedDefaultQuickActions(sb, companyId, bot.id, fields.value.capability_flags);
  await recomputeBotPrompt(sb, companyId, bot.id); // assemble initial system prompt
  if (isHelpdeskBot(fields.value)) {
    await requestHelpdeskConnectorResync(companyId, 'A Help Desk bot was created.');
  }
  revalidatePath('/company/bots');
  redirect(`/company/bots/${bot.id}/settings`);
}

const updateBotSchema = z.object({ botId: z.string().uuid(), aiEnabled: optText });

export async function updateBotAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const meta = updateBotSchema.safeParse(Object.fromEntries(formData));
  if (!meta.success) return { error: 'Invalid request' };
  const fields = readBotFields(formData);
  if ('error' in fields) return { error: fields.error };
  const sb = createSupabaseServiceClient();

  const { error } = await sb
    .from('bots')
    .update({ ...fields.value, ai_enabled: formData.get('aiEnabled') === 'on' })
    .eq('company_id', companyId) // scope guard
    .eq('id', meta.data.botId);
  if (error) return { error: error.message };

  // Newly-enabled capabilities get their default quick action (idempotent).
  await seedDefaultQuickActions(sb, companyId, meta.data.botId, fields.value.capability_flags);
  // Capabilities/type/language may have changed — keep the system prompt in sync.
  await recomputeBotPrompt(sb, companyId, meta.data.botId);
  if (isHelpdeskBot(fields.value)) {
    await requestHelpdeskConnectorResync(companyId, 'Help Desk bot type, capabilities, or widget settings changed.');
  }
  revalidatePath(`/company/bots/${meta.data.botId}/settings`);
  revalidatePath('/company/bots');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Prompt & behavior config (Module 6) — saved in bot_settings; resyncs prompt.
// ---------------------------------------------------------------------------
const promptConfigSchema = z.object({
  botId: z.string().uuid(),
  industry: optText,
  tone: z.enum(['professional', 'friendly', 'concise', 'warm']).default('professional'),
  customInstructions: optText,
  customPrompt: optText,
});

export async function updatePromptConfigAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = promptConfigSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();

  // Verify the bot belongs to this company before saving its settings.
  const { data: bot } = await sb
    .from('bots')
    .select('id,bot_type,capability_flags')
    .eq('company_id', companyId)
    .eq('id', v.botId)
    .maybeSingle();
  if (!bot) return { error: 'Assistant not found' };

  const value = {
    industry: v.industry ?? null,
    tone: v.tone,
    customInstructions: v.customInstructions ?? null,
    customPrompt: v.customPrompt ?? null,
  };
  const { error } = await sb
    .from('bot_settings')
    .upsert(
      { bot_id: v.botId, key: 'prompt_config', value_json: value, updated_by: admin.userId },
      { onConflict: 'bot_id,key' },
    );
  if (error) return { error: error.message };

  await recomputeBotPrompt(sb, companyId, v.botId);
  if (isHelpdeskBot(bot)) {
    await requestHelpdeskConnectorResync(companyId, 'Help Desk bot prompt configuration changed.');
  }
  revalidatePath(`/company/bots/${v.botId}/settings`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Team / agents
// ---------------------------------------------------------------------------
const inviteSchema = z.object({
  email: z.string().email('Valid email required'),
  fullName: optText,
});

export async function inviteAgentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();

  try {
    await assertWithinPlan(companyId, 'create_agent');
  } catch (e) {
    return { error: (e as Error).message };
  }

  const token = createInviteToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  const { data: invite, error: iErr } = await sb
    .from('agent_invites')
    .insert({
      company_id: companyId,
      email: v.email.toLowerCase(),
      full_name: v.fullName ?? null,
      role: ROLES.AGENT,
      token_hash: hashInviteToken(token),
      invited_by: admin.userId,
      expires_at: expiresAt,
      last_sent_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (iErr || !invite) return { error: 'Could not create invite: ' + (iErr?.message ?? '') };

  const inviteUrl = `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/agent-invite/${token}`;
  const emailResult = await sendEmail({
    to: v.email,
    subject: 'You have been invited as a chat agent',
    html: `<p>You have been invited to join the chat agent team.</p><p><a href="${inviteUrl}">Set your password</a></p><p>This link expires in 7 days.</p>`,
  });

  await sb.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: admin.userId,
    action: 'agent.invited',
    target_type: 'agent_invite',
    target_id: invite.id,
    metadata_json: { email: v.email, emailSent: emailResult.sent },
  });

  revalidatePath('/company/agents');
  return { ok: true };
}

const removeSchema = z.object({ membershipId: z.string().uuid() });

export async function removeAgentAction(formData: FormData): Promise<void> {
  const admin = await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const v = removeSchema.parse(Object.fromEntries(formData));
  const sb = createSupabaseServiceClient();

  // Only allow removing an AGENT membership in THIS company (never an admin/self).
  const { error } = await sb
    .from('company_users')
    .delete()
    .eq('id', v.membershipId)
    .eq('company_id', companyId)
    .eq('role', ROLES.AGENT);
  if (!error) {
    await sb.from('audit_logs').insert({
      company_id: companyId,
      actor_user_id: admin.userId,
      action: 'agent.removed',
      target_type: 'membership',
      target_id: v.membershipId,
    });
  }
  revalidatePath('/company/agents');
}
