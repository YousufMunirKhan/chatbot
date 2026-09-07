import { pollGmailIdentities } from '@/lib/channels/pollers/gmail';
import { pollYouTubeIdentities } from '@/lib/channels/pollers/youtube';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Polled channels tick (Gmail mailboxes + YouTube comments).
 *
 * Neither provider gives us a usable webhook out of the box, so both are polled
 * here on a schedule — every 2-5 minutes is a good cadence. Authorised the same
 * way as the other cron routes: a bearer equal to CRON_SECRET, or to
 * SUPABASE_SERVICE_ROLE_KEY for deployments that only set that one.
 */
function authorised(req: Request): boolean {
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!provided) return false;
  const e = serverEnv();
  const accepted = [process.env.CRON_SECRET, e.SUPABASE_SERVICE_ROLE_KEY].filter(
    (v): v is string => Boolean(v),
  );
  if (accepted.length === 0) return false;
  return accepted.includes(provided);
}

async function run(req: Request): Promise<Response> {
  if (!authorised(req)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Both pollers swallow their own per-identity failures; this guard is only for
  // an outright infrastructure error (e.g. the database is unreachable).
  const [gmail, youtube] = await Promise.all([
    pollGmailIdentities().catch((err: unknown) => {
      logger.error('Gmail poller crashed', { error: err instanceof Error ? err.message : String(err) });
      return { identities: 0, events: 0, handled: 0, errors: 1 };
    }),
    pollYouTubeIdentities().catch((err: unknown) => {
      logger.error('YouTube poller crashed', { error: err instanceof Error ? err.message : String(err) });
      return { identities: 0, events: 0, handled: 0, errors: 1 };
    }),
  ]);

  return Response.json({ ok: true, gmail, youtube });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
