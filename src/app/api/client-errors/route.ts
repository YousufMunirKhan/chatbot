import { z } from 'zod';
import { loadBotByPublicId } from '@/lib/ai/engine';
import { errorMessage, logAppError } from '@/lib/application-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  publicBotId: z.string().optional(),
  visitorId: z.string().optional(),
  conversationId: z.string().uuid().optional(),
  source: z.string().min(1).max(80).default('widget'),
  severity: z.enum(['info', 'warning', 'error', 'critical']).default('error'),
  message: z.string().min(1).max(2000),
  route: z.string().max(300).optional(),
  statusCode: z.number().int().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(req: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  let bot: Awaited<ReturnType<typeof loadBotByPublicId>> | null = null;
  if (parsed.publicBotId) {
    try {
      bot = await loadBotByPublicId(parsed.publicBotId);
    } catch {
      bot = null;
    }
  }

  await logAppError({
    companyId: bot?.companyId ?? null,
    botId: bot?.id ?? null,
    conversationId: parsed.conversationId ?? null,
    source: parsed.source,
    severity: parsed.severity,
    message: parsed.message,
    route: parsed.route ?? req.headers.get('referer') ?? null,
    statusCode: parsed.statusCode ?? null,
    metadata: {
      ...parsed.metadata,
      publicBotId: parsed.publicBotId,
      visitorId: parsed.visitorId,
      origin: req.headers.get('origin'),
      userAgent: req.headers.get('user-agent'),
    },
  }).catch((err) => {
    console.error(errorMessage(err));
  });

  return Response.json({ ok: true });
}
