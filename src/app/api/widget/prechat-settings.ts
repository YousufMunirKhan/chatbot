import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';

/**
 * Pre-chat form + out-of-hours settings for one company.
 *
 * This normally belongs in `src/modules/company/*-data.ts` with the rest of the
 * dashboard reads. It lives beside the widget routes instead because all three
 * readers are widget routes — the public config endpoint, the pre-chat capture
 * endpoint that has to re-check what the form claimed was required, and the
 * admin settings endpoint — and a company that has never opened the settings
 * has no row at all, so every one of them needs the same defaults applied in
 * the same place or they will disagree about what "required" meant.
 */

export interface WidgetPrechatSettings {
  prechatEnabled: boolean;
  prechatAskName: boolean;
  prechatAskEmail: boolean;
  prechatAskPhone: boolean;
  prechatRequired: boolean;
  prechatAllowSkip: boolean;
  prechatTitle: string;
  prechatIntro: string;
  prechatButtonLabel: string;
  offlineEnabled: boolean;
  offlineMessage: string;
  offlineFormEnabled: boolean;
  offlineButtonLabel: string;
}

export const WIDGET_PRECHAT_DEFAULTS: WidgetPrechatSettings = {
  prechatEnabled: false,
  prechatAskName: true,
  prechatAskEmail: true,
  prechatAskPhone: false,
  prechatRequired: true,
  prechatAllowSkip: true,
  prechatTitle: 'Before we start',
  prechatIntro: 'Leave your details and we can pick this up again if we get cut off.',
  prechatButtonLabel: 'Start chat',
  offlineEnabled: true,
  offlineMessage:
    'We are closed at the moment. Leave your details and we will reply as soon as we are back.',
  offlineFormEnabled: true,
  offlineButtonLabel: 'Leave a message',
};

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

export function mapWidgetPrechatSettings(row: Record<string, unknown> | null): WidgetPrechatSettings {
  if (!row) return { ...WIDGET_PRECHAT_DEFAULTS };
  const d = WIDGET_PRECHAT_DEFAULTS;
  return {
    prechatEnabled: bool(row.prechat_enabled, d.prechatEnabled),
    prechatAskName: bool(row.prechat_ask_name, d.prechatAskName),
    prechatAskEmail: bool(row.prechat_ask_email, d.prechatAskEmail),
    prechatAskPhone: bool(row.prechat_ask_phone, d.prechatAskPhone),
    prechatRequired: bool(row.prechat_required, d.prechatRequired),
    prechatAllowSkip: bool(row.prechat_allow_skip, d.prechatAllowSkip),
    prechatTitle: text(row.prechat_title, d.prechatTitle),
    prechatIntro: text(row.prechat_intro, d.prechatIntro),
    prechatButtonLabel: text(row.prechat_button_label, d.prechatButtonLabel),
    offlineEnabled: bool(row.offline_enabled, d.offlineEnabled),
    offlineMessage: text(row.offline_message, d.offlineMessage),
    offlineFormEnabled: bool(row.offline_form_enabled, d.offlineFormEnabled),
    offlineButtonLabel: text(row.offline_button_label, d.offlineButtonLabel),
  };
}

export async function loadWidgetPrechatSettings(companyId: string): Promise<WidgetPrechatSettings> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('widget_prechat_settings')
    .select(
      'prechat_enabled,prechat_ask_name,prechat_ask_email,prechat_ask_phone,prechat_required,prechat_allow_skip,prechat_title,prechat_intro,prechat_button_label,offline_enabled,offline_message,offline_form_enabled,offline_button_label',
    )
    .eq('company_id', companyId)
    .maybeSingle();
  // A read failure must not take the widget down with it: the defaults leave the
  // pre-chat gate off, which is the behaviour every existing customer has today.
  if (error) {
    logger.warn('Could not read widget pre-chat settings', { companyId, error: error.message });
    return { ...WIDGET_PRECHAT_DEFAULTS };
  }
  return mapWidgetPrechatSettings((data as Record<string, unknown> | null) ?? null);
}
