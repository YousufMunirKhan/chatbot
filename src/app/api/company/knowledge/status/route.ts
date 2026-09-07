import { NextResponse } from 'next/server';
import { assertRole, getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { ForbiddenError, RateLimitError, UnauthorizedError, handleApiError } from '@/lib/errors';
import { drainCompanyKnowledgeJobs } from '@/lib/knowledge/ingest-queue';
import { getKnowledgeStatus } from '@/lib/knowledge/status';
import { rateLimitDistributed } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Live ingest status for the company on the session, and a way to make the
 * queue move while somebody is watching it.
 *
 * The two verbs are split on purpose. GET is a pure read and returns in a few
 * milliseconds, so the panel can poll it every couple of seconds and show a
 * progress bar that actually advances. POST does the WORK — it drains this
 * company's queued knowledge jobs — and can legitimately take half a minute
 * embedding a 60-page PDF. Doing both in one handler would mean the poll that
 * reports progress is the same request that is blocked producing it, and the
 * bar would sit still until the whole document finished, which is the lying
 * spinner this feature exists to remove.
 *
 * POST is a convenience, not the mechanism: `/api/cron?task=jobs` drains the
 * same jobs every five minutes whether anyone is looking or not. This just
 * means an admin who uploads a file does not wait up to five minutes for
 * anything to happen. `drainCompanyKnowledgeJobs` claims each job with a
 * conditional update, so it and the cron drain can safely run at once.
 *
 * The company id comes from the session and is never read from the request, so
 * neither verb can be pointed at another tenant.
 */

async function companyIdFromSession(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  assertRole(user, [ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  if (!user.companyId) throw new ForbiddenError('This account is not attached to a company.');
  return user.companyId;
}

export async function GET() {
  try {
    const companyId = await companyIdFromSession();
    return NextResponse.json(await getKnowledgeStatus(companyId));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST() {
  try {
    const user = await getSessionUser();
    if (!user) throw new UnauthorizedError();
    // Draining spends embedding tokens, so it is admin-only even though reading
    // the status is not.
    assertRole(user, [ROLES.COMPANY_ADMIN]);
    if (!user.companyId) throw new ForbiddenError('This account is not attached to a company.');

    // Per company: two admins with the page open should not be able to spin the
    // queue faster than one, and a tab left open overnight must not either.
    const limit = await rateLimitDistributed(`knowledge-drain:${user.companyId}`, 30, 60_000);
    if (!limit.ok) throw new RateLimitError('Indexing is already running. Give it a moment.');

    const processed = await drainCompanyKnowledgeJobs(user.companyId);
    return NextResponse.json({ processed, ...(await getKnowledgeStatus(user.companyId)) });
  } catch (err) {
    return handleApiError(err);
  }
}
