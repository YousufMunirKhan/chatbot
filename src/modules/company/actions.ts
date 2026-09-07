'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { revokeSessionsIfAccessEnded } from '@/lib/auth/revoke';
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
const optEnabled = z.preprocess((x) => (x == null ? true : x === 'on'), z.boolean());

/**
 * Copy/colour seed for a BRAND-NEW assistant only (Issue #38). Everything else in
 * `appearance_json` is left unset so the widget config route's own fallbacks apply;
 * from then on the Widget Design Studio owns those fields.
 */
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
/**
 * Only the fields the Configuration form (`bot-form.tsx`) actually renders. The
 * ~40 widget appearance fields this schema used to parse were dead — the form
 * stopped rendering them when the Widget Design Studio took over — and rebuilding
 * a full `appearance_json` from them turned every save into a read-modify-write
 * race against `widget-design-actions.ts` on the same JSON cell (Issues #38/#18).
 */
const botBaseSchema = z.object({
  name: z.string().min(2, 'Assistant name is required'),
  assistantAudience: z.enum(ASSISTANT_AUDIENCES).default('customer'),
  botType: z.enum(BOT_TYPES),
  languageDefault: z.enum(['en', 'ar', 'auto']),
  enableDefaultPills: optEnabled,
  enableContextualPills: optEnabled,
  enableConnectorGeneratedPills: optEnabled,
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
  return {
    value: {
      name: v.name,
      bot_type: v.botType,
      language_default: v.languageDefault,
      capability_flags: capabilities,
      domain_allowlist: domainAllowlist,
    },
    /** The only `appearance_json` keys this form owns — everything else is design. */
    appearance: {
      assistantAudience: v.assistantAudience,
      enableDefaultPills: v.enableDefaultPills,
      enableContextualPills: v.enableContextualPills,
      enableConnectorGeneratedPills: v.enableConnectorGeneratedPills,
    },
  } as const;
}

function isHelpdeskBot(value: { bot_type?: unknown; capability_flags?: unknown }): boolean {
  return (
    value.bot_type === 'help_desk' ||
    (Array.isArray(value.capability_flags) &&
      value.capability_flags.some((cap) => String(cap).startsWith('internal_')))
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
    const [{ count }, { data: existingBots }] = await Promise.all([
      sb
        .from('bots')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
      sb
        .from('bots')
        .select('id')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(1),
    ]);
    if ((count ?? 0) >= botLimit) {
      const existingId = existingBots?.[0]?.id as string | undefined;
      if (existingId) redirect(`/company/bots/${existingId}/settings`);
      return { error: `Your plan allows up to ${botLimit} assistant(s). Upgrade to add more.` };
    }
  }

  // A new bot gets the audience-appropriate copy seed plus the fields this form
  // owns; the Design Studio fills in the rest the first time it is saved.
  const appearance = {
    ...appearanceDefaults(fields.appearance.assistantAudience, fields.value.name),
    ...fields.appearance,
  };

  const { data: bot, error } = await sb
    .from('bots')
    .insert({ company_id: companyId, ...fields.value, appearance_json: appearance })
    .select('id')
    .single();
  if (error || !bot) return { error: error?.message ?? 'Could not create assistant' };

  // Seed editable default in-chat quick actions (lead / appointment / handoff)
  // for the enabled capabilities so forms work in the widget out of the box.
  await seedDefaultQuickActions(
    sb,
    companyId,
    bot.id,
    fields.value.capability_flags,
    appearance.assistantAudience,
    appearance.enableDefaultPills !== false,
  );
  await recomputeBotPrompt(sb, companyId, bot.id); // assemble initial system prompt
  if (isHelpdeskBot(fields.value)) {
    await requestHelpdeskConnectorResync(companyId, 'A Help Desk bot was created.');
  }
  revalidatePath('/company/bots');
  redirect(`/company/bots/${bot.id}/settings?created=1`);
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

  // Widget design (colors, launcher, labels, layout) is owned by the Design Studio
  // (/company/widget). This form patches ONLY the handful of appearance keys it owns
  // on top of whatever the Design Studio last saved, so a Configuration save can no
  // longer clobber live design.
  const { data: existing } = await sb
    .from('bots')
    .select('name, appearance_json')
    .eq('company_id', companyId)
    .eq('id', meta.data.botId)
    .maybeSingle();
  const prevAppearance = (existing?.appearance_json as Record<string, unknown> | null) ?? {};
  const previousName = typeof existing?.name === 'string' ? existing.name.trim() : '';
  const previousTitle = typeof prevAppearance.title === 'string' ? prevAppearance.title.trim() : '';
  // Renaming a bot used to leave the widget header on the old name because the
  // previous appearance always won. A title that is still just the old bot name
  // (or missing) follows the rename; a custom Design Studio title is left alone.
  const followsName = !previousTitle || previousTitle === previousName;

  const mergedAppearance = {
    ...prevAppearance,
    ...fields.appearance,
    ...(followsName ? { title: fields.value.name } : {}),
  };

  const { error } = await sb
    .from('bots')
    .update({ ...fields.value, appearance_json: mergedAppearance, ai_enabled: formData.get('aiEnabled') === 'on' })
    .eq('company_id', companyId) // scope guard
    .eq('id', meta.data.botId);
  if (error) return { error: error.message };

  // Newly-enabled capabilities get their default quick action (idempotent).
  await seedDefaultQuickActions(
    sb,
    companyId,
    meta.data.botId,
    fields.value.capability_flags,
    fields.appearance.assistantAudience,
    fields.appearance.enableDefaultPills !== false,
  );
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

/**
 * Take a teammate off the team and end the session they are signed in on.
 *
 * The membership row going away is the half that has to happen: it is what
 * every permission check in the app reads. Signing them out is the half that
 * makes it immediate, and it depends on the auth service answering, so it runs
 * after the delete and its failure is reported rather than allowed to roll back
 * a removal the admin has already been told is done. The Team page promises the
 * person "is signed out immediately"; before this it was only true once their
 * token expired on its own.
 */
async function removeAgent(membershipId: string): Promise<ActionState> {
  const admin = await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  // Read before deleting: the membership row holds the only pointer to the
  // login whose sessions have to go. The filters are the same three as the
  // delete below — an AGENT membership in THIS company — so an admin, another
  // tenant's member, and the caller themselves are all out of reach. Self
  // removal cannot happen through here at all: one person holds at most one row
  // per company, and whoever passed `requireRole` above holds the admin one.
  const { data: membership } = await sb
    .from('company_users')
    .select('user_id')
    .eq('id', membershipId)
    .eq('company_id', companyId)
    .eq('role', ROLES.AGENT)
    .maybeSingle();

  const { error } = await sb
    .from('company_users')
    .delete()
    .eq('id', membershipId)
    .eq('company_id', companyId)
    .eq('role', ROLES.AGENT);
  if (error) {
    revalidatePath('/company/agents');
    return { error: `Could not remove them from the team: ${error.message}` };
  }

  const userId = (membership as { user_id?: string } | null)?.user_id ?? null;
  if (!userId) {
    // Nothing matched those filters, so nothing was deleted and there is no
    // session to end — the row was already gone, or it was never this
    // company's to remove. Either way the team list is now what was asked for.
    revalidatePath('/company/agents');
    return { ok: true };
  }

  const revocation = await revokeSessionsIfAccessEnded(sb, userId, companyId, ROLES.AGENT);

  await sb.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: admin.userId,
    action: 'agent.removed',
    target_type: 'membership',
    target_id: membershipId,
    // The outcome is on the audit entry because "we removed them but could not
    // sign them out" is the fact a security review needs months later, long
    // after the message below has been dismissed.
    metadata_json: { userId, revocation },
  });

  revalidatePath('/company/agents');

  if (revocation.status === 'failed') {
    return {
      error:
        'Removed from the team, but they could not be signed out of a browser they are already using — ' +
        `that session lasts until it expires. Reason: ${revocation.reason}`,
    };
  }
  return { ok: true };
}

/**
 * The Team page submits this straight from `<form action={...}>`, which has
 * nowhere to put a returned message. A revocation failure still reaches an
 * operator through the server log and the audit entry; the message needs the
 * `useFormState` variant below.
 */
export async function removeAgentAction(formData: FormData): Promise<void> {
  const v = removeSchema.parse(Object.fromEntries(formData));
  await removeAgent(v.membershipId);
}

/** The same removal in the shape a `useFormState` form can show the result of. */
export async function removeAgentWithFeedbackAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = removeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  return removeAgent(parsed.data.membershipId);
}
