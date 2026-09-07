import { z } from 'zod';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { ApiError, apiData, withApiAuth } from '@/lib/api/handler';
import { CONTACT_COLUMNS, toApiContact } from '@/lib/api/serializers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid('Contact id must be a UUID.');

/** GET /api/v1/contacts/:id */
export const GET = withApiAuth('contacts:read', async (ctx) => {
  const id = idSchema.parse(ctx.params.id);
  const sb = createSupabaseServiceClient();

  const { data, error } = await sb
    .from('leads')
    .select(CONTACT_COLUMNS)
    // TENANT ISOLATION: another tenant's id must look exactly like a missing id.
    .eq('company_id', ctx.companyId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new ApiError('internal_error', 'Could not load the contact.');
  if (!data) throw new ApiError('not_found', 'Contact not found.');

  return apiData(toApiContact(data as Record<string, unknown>));
});
