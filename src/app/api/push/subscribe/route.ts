import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getVapidKeys } from '@/lib/push/vapid';
import { handleApiError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Push subscription registration for the dashboard PWA.
 *
 * GET  — what the browser needs before it can subscribe: whether push is
 *        configured at all, and the VAPID public key to pass as
 *        `applicationServerKey`. The public key is public by definition (it
 *        ships inside every subscription), so serving it here avoids a second
 *        NEXT_PUBLIC_* variable that could drift from the private half.
 * POST — store or refresh one browser's subscription.
 *
 * Route handlers use `getSessionUser` rather than `requireRole`: this is called
 * by `fetch`, and a redirect to /login is useless to a JSON caller.
 */

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const keys = getVapidKeys();
    return NextResponse.json({
      configured: keys !== null,
      publicKey: keys?.publicKey ?? null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    if (!user.companyId) return NextResponse.json({ error: 'no_company' }, { status: 403 });

    const parsed = subscribeSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

    const sb = createSupabaseServiceClient();
    // The endpoint is unique per browser install, so re-subscribing the same
    // device rebinds it to the current user and company instead of leaving a
    // stale row that would push a former colleague's phone.
    const { error } = await sb.from('push_subscriptions').upsert(
      {
        company_id: user.companyId,
        user_id: user.userId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        user_agent: (req.headers.get('user-agent') ?? '').slice(0, 400) || null,
        last_seen_at: new Date().toISOString(),
        failed_count: 0,
      },
      { onConflict: 'endpoint' },
    );
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
