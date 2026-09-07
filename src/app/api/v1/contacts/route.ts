import { z } from 'zod';
import { createSupabaseServiceClient } from '@/lib/db/server';
import {
  ApiError,
  apiData,
  paginationMeta,
  parseIsoDate,
  parsePagination,
  withApiAuth,
} from '@/lib/api/handler';
import { dispatchDeveloperEvent } from '@/lib/api/developer-events';
import { CONTACT_COLUMNS, toApiContact } from '@/lib/api/serializers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Contacts are the `leads` table — the CRM record the assistant captures and
 * the Customers screen shows. `synced_customers` is deliberately NOT exposed
 * here: those rows are a mirror of an external store, owned by the connector.
 */
const STATUSES = ['new', 'contacted', 'qualified', 'converted', 'closed'];

/** GET /api/v1/contacts — paginated, filterable by status, source, since, q. */
export const GET = withApiAuth('contacts:read', async (ctx) => {
  const pagination = parsePagination(ctx.searchParams);
  const status = ctx.searchParams.get('status');
  const source = ctx.searchParams.get('source');
  const since = parseIsoDate(ctx.searchParams.get('since'), 'since');
  const q = ctx.searchParams.get('q');

  if (status && !STATUSES.includes(status)) {
    throw new ApiError('invalid_request', `\`status\` must be one of: ${STATUSES.join(', ')}.`);
  }

  const sb = createSupabaseServiceClient();
  let query = sb
    .from('leads')
    .select(CONTACT_COLUMNS, { count: 'exact' })
    // TENANT ISOLATION: the key's company, never a request value.
    .eq('company_id', ctx.companyId)
    .order('created_at', { ascending: false })
    .range(pagination.from, pagination.to);

  if (status) query = query.eq('status', status);
  if (source) query = query.eq('source', source);
  if (since) query = query.gte('created_at', since);
  if (q) {
    // Commas and parentheses would break out of the `or` filter grammar.
    const safe = q.replace(/[,()*]/g, ' ').trim();
    if (safe) query = query.or(`name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`);
  }

  const { data, count, error } = await query;
  if (error) throw new ApiError('internal_error', 'Could not load contacts.');

  return apiData(
    (data ?? []).map((row) => toApiContact(row as Record<string, unknown>)),
    paginationMeta(pagination, count),
  );
});

const createSchema = z
  .object({
    name: z.string().max(200).optional(),
    email: z.string().email('email must be a valid address').max(320).optional(),
    phone: z.string().max(50).optional(),
    enquiry_type: z.string().max(120).optional(),
    message: z.string().max(4000).optional(),
    source_page: z.string().max(500).optional(),
    status: z.enum(['new', 'contacted', 'qualified', 'converted', 'closed']).default('new'),
  })
  .refine((v) => Boolean(v.email || v.phone || v.name), {
    message: 'Provide at least one of `name`, `email` or `phone`.',
  });

/** POST /api/v1/contacts — create a contact and fire `contact.created`. */
export const POST = withApiAuth('contacts:write', async (ctx) => {
  const body = createSchema.parse(await ctx.json());
  const sb = createSupabaseServiceClient();

  const { data, error } = await sb
    .from('leads')
    .insert({
      company_id: ctx.companyId,
      name: body.name ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      enquiry_type: body.enquiry_type ?? null,
      message: body.message ?? null,
      source_page: body.source_page ?? null,
      source: 'api',
      status: body.status,
    })
    .select(CONTACT_COLUMNS)
    .single();
  if (error || !data) throw new ApiError('internal_error', 'Could not create the contact.');

  const contact = toApiContact(data as Record<string, unknown>);
  await dispatchDeveloperEvent({
    companyId: ctx.companyId,
    event: 'contact.created',
    title: `New contact: ${contact.name ?? contact.email ?? contact.phone ?? 'unnamed'}`,
    body: contact.message ?? undefined,
    data: { ...contact },
  });

  return apiData(contact, undefined, 201);
});
