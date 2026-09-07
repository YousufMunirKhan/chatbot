import { ApiError, apiData, withApiAuth } from '@/lib/api/handler';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getSubscription } from '@/lib/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/auth/me — who this API key belongs to.
 *
 * Zapier (and every other integration platform) tests a connection by calling
 * one cheap authenticated endpoint and labelling the connection with what comes
 * back, so that a customer with three accounts connected can tell them apart.
 * Without it the test has to borrow a data endpoint, and an account with no
 * conversations yet looks like a broken key.
 *
 * Nothing here is a secret: the company is the key's own company, and the
 * scopes are the ones the caller already holds. `withApiAuth` has resolved both
 * from the key before this runs — no request value widens either.
 */
export const GET = withApiAuth('conversations:read', async (ctx) => {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('companies')
    .select('id,name,website,country,timezone,default_language,status,created_at')
    .eq('id', ctx.companyId)
    .maybeSingle();
  if (error) throw new ApiError('internal_error', 'Could not load the account.');
  if (!data) throw new ApiError('not_found', 'Account not found.');

  const company = data as Record<string, unknown>;
  const subscription = await getSubscription(ctx.companyId);

  return apiData({
    company: {
      id: company.id as string,
      name: (company.name as string) ?? '',
      website: (company.website as string) ?? null,
      country: (company.country as string) ?? null,
      timezone: (company.timezone as string) ?? null,
      default_language: (company.default_language as string) ?? 'auto',
      status: (company.status as string) ?? 'active',
      created_at: (company.created_at as string) ?? null,
    },
    plan: {
      name: subscription?.plan ?? null,
      status: subscription?.status ?? null,
    },
    api_key: {
      id: ctx.apiKeyId,
      scopes: ctx.scopes,
    },
  });
});
