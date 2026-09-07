/**
 * WhatsApp message templates (Meta Cloud API).
 *
 * Outside the 24-hour customer service window WhatsApp refuses free-form
 * messages, so every piece of outbound marketing/utility traffic has to go
 * through a template Meta has approved. This module owns the whole lifecycle:
 * submit a draft for review, sync the approval status back, delete, and send.
 *
 * The message-shaping helpers are deliberately pure (no network, no DB) so the
 * exact JSON we hand Meta can be asserted in tests without credentials.
 */

import { getJson, postJson, request } from './http';
import { sendWhatsAppRaw } from './adapters/whatsapp';
import { logger } from '@/lib/logger';

const GRAPH = 'https://graph.facebook.com/v19.0';

export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
export type TemplateStatus = 'draft' | 'pending' | 'approved' | 'rejected';

/** Positional (`{{1}}`, `{{2}}`…) or named (`{{first_name}}`) placeholders. */
export type TemplateVariables = string[] | Record<string, string>;

export interface TemplateHeader {
  /** TEXT headers are the only kind we can fully round-trip without media ids. */
  format: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  text?: string;
}

export interface TemplateButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text: string;
  url?: string;
  phone_number?: string;
}

export interface TemplateDraft {
  name: string;
  language: string;
  category: TemplateCategory;
  body: string;
  header?: TemplateHeader | null;
  footer?: string | null;
  buttons?: TemplateButton[];
}

export interface MetaTemplateSummary {
  id: string;
  name: string;
  language: string;
  category: string;
  status: TemplateStatus;
  rejectionReason: string | null;
  /** The template body as it exists in Meta, when the API returned it. */
  body: string | null;
}

/**
 * Template names are lowercase snake_case in Meta's namespace; anything else is
 * rejected at submission time, so normalise before we ever call the API.
 */
export function normalizeTemplateName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512);
}

/** How many `{{n}}` placeholders a template body/header uses. */
export function countPlaceholders(text: string): number {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) found.add(m[1] as string);
  return found.size;
}

/** Meta's `components` array for a template *definition* (creation payload). */
export function buildTemplateComponents(draft: TemplateDraft): Record<string, unknown>[] {
  const components: Record<string, unknown>[] = [];

  if (draft.header) {
    const header: Record<string, unknown> = { type: 'HEADER', format: draft.header.format };
    if (draft.header.format === 'TEXT' && draft.header.text) header.text = draft.header.text;
    components.push(header);
  }

  components.push({ type: 'BODY', text: draft.body });

  if (draft.footer) components.push({ type: 'FOOTER', text: draft.footer });

  const buttons = draft.buttons ?? [];
  if (buttons.length) {
    components.push({
      type: 'BUTTONS',
      buttons: buttons.slice(0, 10).map((b) => {
        const out: Record<string, unknown> = { type: b.type, text: b.text.slice(0, 25) };
        if (b.type === 'URL' && b.url) out.url = b.url;
        if (b.type === 'PHONE_NUMBER' && b.phone_number) out.phone_number = b.phone_number;
        return out;
      }),
    });
  }

  return components;
}

function textParameters(variables: TemplateVariables): Record<string, unknown>[] {
  if (Array.isArray(variables)) {
    return variables.map((text) => ({ type: 'text', text: String(text ?? '') }));
  }
  return Object.entries(variables).map(([parameter_name, text]) => ({
    type: 'text',
    parameter_name,
    text: String(text ?? ''),
  }));
}

/**
 * Build the `type:'template'` Cloud API message object.
 *
 * Pure: the caller posts it. Empty variable sets omit the body component
 * entirely, because Meta rejects a component with an empty `parameters` array.
 */
export function buildTemplateMessage(
  templateName: string,
  language: string,
  variables: TemplateVariables = [],
  opts: { headerVariables?: string[]; buttonUrlVariables?: string[] } = {},
): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];

  const headerVars = opts.headerVariables ?? [];
  if (headerVars.length) {
    components.push({ type: 'header', parameters: textParameters(headerVars) });
  }

  const bodyParams = textParameters(variables);
  if (bodyParams.length) components.push({ type: 'body', parameters: bodyParams });

  (opts.buttonUrlVariables ?? []).forEach((value, index) => {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: String(index),
      parameters: [{ type: 'text', text: String(value ?? '') }],
    });
  });

  const template: Record<string, unknown> = {
    name: templateName,
    language: { code: language || 'en_US' },
  };
  if (components.length) template.components = components;

  return { type: 'template', template };
}

/**
 * Send an approved template. This is the only reliable way to reach a contact
 * who has not messaged in the last 24 hours.
 */
export async function sendWhatsAppTemplate(
  token: string,
  phoneNumberId: string,
  to: string,
  templateName: string,
  language: string,
  variables: TemplateVariables = [],
  opts: { headerVariables?: string[]; buttonUrlVariables?: string[] } = {},
): Promise<boolean> {
  const message = buildTemplateMessage(templateName, language, variables, opts);
  return sendWhatsAppRaw(token, phoneNumberId, to, message);
}

/** Submit a template to Meta for review. Returns the new template id. */
export async function createMetaTemplate(
  token: string,
  wabaId: string,
  draft: TemplateDraft,
): Promise<{ ok: boolean; id?: string; status?: string; error?: string }> {
  const res = await postJson<{ id?: string; status?: string; error?: { message?: string } }>(
    `${GRAPH}/${wabaId}/message_templates`,
    {
      name: normalizeTemplateName(draft.name),
      language: draft.language,
      category: draft.category,
      components: buildTemplateComponents(draft),
    },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const message = res.body?.error?.message ?? res.error ?? `Meta rejected the template (HTTP ${res.status})`;
    logger.warn('WhatsApp template creation failed', { wabaId, name: draft.name, error: message });
    return { ok: false, error: message };
  }
  return { ok: true, id: res.body?.id, status: res.body?.status };
}

interface MetaTemplateRow {
  id?: string;
  name?: string;
  language?: string;
  category?: string;
  status?: string;
  rejected_reason?: string;
  components?: Array<{ type?: string; text?: string }>;
}

/** The BODY component's text, which is the template as the customer reads it. */
export function bodyTextOf(components: MetaTemplateRow['components']): string | null {
  const body = (components ?? []).find((c) => String(c.type ?? '').toUpperCase() === 'BODY');
  const text = body?.text?.trim();
  return text ? text : null;
}

/** Read the current review status of every template on the WABA. */
export async function listMetaTemplates(
  token: string,
  wabaId: string,
): Promise<{ ok: boolean; templates: MetaTemplateSummary[]; error?: string }> {
  const res = await getJson<{ data?: MetaTemplateRow[]; error?: { message?: string } }>(
    `${GRAPH}/${wabaId}/message_templates?limit=200&fields=id,name,language,category,status,rejected_reason,components`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const message = res.body?.error?.message ?? res.error ?? `Meta template sync failed (HTTP ${res.status})`;
    return { ok: false, templates: [], error: message };
  }
  const templates = (res.body?.data ?? []).map((row) => ({
    id: row.id ?? '',
    name: row.name ?? '',
    language: row.language ?? '',
    category: row.category ?? '',
    status: mapMetaStatus(row.status),
    rejectionReason: row.rejected_reason && row.rejected_reason !== 'NONE' ? row.rejected_reason : null,
    body: bodyTextOf(row.components),
  }));
  return { ok: true, templates };
}

/** Meta's status vocabulary is wider than ours; collapse it to four states. */
export function mapMetaStatus(status: string | null | undefined): TemplateStatus {
  const s = String(status ?? '').toUpperCase();
  if (s === 'APPROVED') return 'approved';
  if (s === 'REJECTED' || s === 'DISABLED' || s === 'PAUSED') return 'rejected';
  if (s === 'PENDING' || s === 'IN_APPEAL' || s === 'PENDING_DELETION') return 'pending';
  return 'draft';
}

/** Delete a template from the WABA (by name — Meta deletes every language). */
export async function deleteMetaTemplate(
  token: string,
  wabaId: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await request<{ error?: { message?: string } }>(
    `${GRAPH}/${wabaId}/message_templates?name=${encodeURIComponent(name)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    return { ok: false, error: res.body?.error?.message ?? res.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}
