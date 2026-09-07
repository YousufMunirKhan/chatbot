import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { handleApiError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Turn phone alerts off for the device making the request.
 *
 * Deleting by endpoint AND user id means one agent can never unsubscribe
 * another's phone by guessing an endpoint URL, and the company filter keeps the
 * delete inside the tenant like every other write in this codebase.
 */
const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) });

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    if (!user.companyId) return NextResponse.json({ error: 'no_company' }, { status: 403 });

    const parsed = unsubscribeSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

    const sb = createSupabaseServiceClient();
    const { error } = await sb
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', parsed.data.endpoint)
      .eq('user_id', user.userId)
      .eq('company_id', user.companyId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
