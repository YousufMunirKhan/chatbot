import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertRole, getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { ForbiddenError, RateLimitError, UnauthorizedError, handleApiError } from '@/lib/errors';
import { rateLimitDistributed } from '@/lib/ratelimit';
import { runCopilot } from '@/lib/ai/copilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  mode: z.enum(['suggest_reply', 'summarise', 'rephrase']),
  draft: z.string().max(4000).optional(),
  tone: z.enum(['friendly', 'formal', 'concise', 'apologetic']).optional(),
});

/**
 * Agent copilot for the inbox: draft a reply, summarise the thread, reword a
 * draft. Everything it returns is text for the agent's compose box — this route
 * writes no message and changes no conversation, so an accidental double click
 * costs tokens and nothing else.
 *
 * Agents get this as well as company admins: it is a tool for the person
 * actually working the queue. The company id comes from the session rather than
 * the request body, so the conversation id in the body can only ever resolve
 * inside the caller's own tenant.
 */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) throw new UnauthorizedError();
    assertRole(user, [ROLES.COMPANY_ADMIN, ROLES.AGENT]);
    if (!user.companyId) throw new ForbiddenError('This account is not attached to a company.');

    // Per agent, not per company: one person leaning on the button should not
    // lock their colleagues out of it.
    const limit = await rateLimitDistributed(`copilot:${user.userId}`, 20, 60_000);
    if (!limit.ok) throw new RateLimitError('Too many copilot requests. Wait a moment.');

    const body = bodySchema.parse(await req.json());
    const result = await runCopilot({
      companyId: user.companyId,
      conversationId: body.conversationId,
      mode: body.mode,
      draft: body.draft,
      tone: body.tone,
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
