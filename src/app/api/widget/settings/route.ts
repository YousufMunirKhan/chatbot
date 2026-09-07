import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { handleApiError } from '@/lib/errors';
import { loadWidgetPrechatSettings, WIDGET_PRECHAT_DEFAULTS } from '../prechat-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Company admin read/write for the widget's pre-chat form and out-of-hours
 * message.
 *
 * A route handler rather than a server action because these two panels sit
 * inside the design studio's existing `<form>`, which posts the whole appearance
 * payload to `updateWidgetDesignAction`. Nesting a second form is invalid HTML,
 * and folding these into the appearance action would put a company-wide policy
 * behind a per-assistant save button. `getSessionUser` rather than `requireRole`
 * for the same reason the push route gives: a redirect to /login is useless to
 * a `fetch` caller.
 */

const bodySchema = z.object({
  prechatEnabled: z.boolean(),
  prechatAskName: z.boolean(),
  prechatAskEmail: z.boolean(),
  prechatAskPhone: z.boolean(),
  prechatRequired: z.boolean(),
  prechatAllowSkip: z.boolean(),
  prechatTitle: z.string().trim().max(120),
  prechatIntro: z.string().trim().max(400),
  prechatButtonLabel: z.string().trim().max(60),
  offlineEnabled: z.boolean(),
  offlineMessage: z.string().trim().max(600),
  offlineFormEnabled: z.boolean(),
  offlineButtonLabel: z.string().trim().max(60),
});

function orDefault(value: string, fallback: string): string {
  return value.trim() ? value.trim() : fallback;
}

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    if (!user.companyId) return NextResponse.json({ error: 'no_company' }, { status: 403 });
    return NextResponse.json({ settings: await loadWidgetPrechatSettings(user.companyId) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    if (!user.companyId) return NextResponse.json({ error: 'no_company' }, { status: 403 });
    // Agents can read the settings the widget is running on, but only a company
    // admin decides whether strangers are asked for an email.
    if (!user.isSuperAdmin && user.role !== ROLES.COMPANY_ADMIN) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    const v = parsed.data;
    const d = WIDGET_PRECHAT_DEFAULTS;

    const sb = createSupabaseServiceClient();
    const { error } = await sb.from('widget_prechat_settings').upsert(
      {
        company_id: user.companyId,
        prechat_enabled: v.prechatEnabled,
        prechat_ask_name: v.prechatAskName,
        prechat_ask_email: v.prechatAskEmail,
        prechat_ask_phone: v.prechatAskPhone,
        prechat_required: v.prechatRequired,
        prechat_allow_skip: v.prechatAllowSkip,
        prechat_title: orDefault(v.prechatTitle, d.prechatTitle),
        prechat_intro: orDefault(v.prechatIntro, d.prechatIntro),
        prechat_button_label: orDefault(v.prechatButtonLabel, d.prechatButtonLabel),
        offline_enabled: v.offlineEnabled,
        offline_message: orDefault(v.offlineMessage, d.offlineMessage),
        offline_form_enabled: v.offlineFormEnabled,
        offline_button_label: orDefault(v.offlineButtonLabel, d.offlineButtonLabel),
        updated_by: user.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id' },
    );
    if (error) throw error;

    return NextResponse.json({ ok: true, settings: await loadWidgetPrechatSettings(user.companyId) });
  } catch (err) {
    return handleApiError(err);
  }
}
