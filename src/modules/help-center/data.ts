import { loadBotByPublicId } from '@/lib/ai/engine';
import { createSupabaseServiceClient } from '@/lib/db/server';

export interface HelpCenterBrand {
  publicBotId: string;
  name: string;
  title: string;
  primaryColor: string;
}

export interface ArticleSummary {
  id: string;
  title: string;
  excerpt: string;
}

export interface ArticleDetail extends ArticleSummary {
  content: string;
}

function brandFrom(publicBotId: string, name: string, appearance: Record<string, unknown>): HelpCenterBrand {
  return {
    publicBotId,
    name,
    title: (appearance.helpCenterTitle as string) || (appearance.title as string) || `${name} Help Center`,
    primaryColor: (appearance.primaryColor as string) || '#045fff',
  };
}

function excerptOf(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

/** Public (unauthenticated) list of customer-facing knowledge articles. */
export async function getHelpCenter(
  publicBotId: string,
): Promise<{ brand: HelpCenterBrand; articles: ArticleSummary[] } | null> {
  const bot = await loadBotByPublicId(publicBotId);
  if (!bot || bot.assistantAudience === 'internal') return null;

  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('documents')
    .select('id,title,document_sources(raw_text)')
    .eq('company_id', bot.companyId)
    .in('audience', ['customer', 'both'])
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(200);

  const articles: ArticleSummary[] = (data ?? []).map((d) => {
    const x = d as Record<string, unknown>;
    const sources = x.document_sources as Array<{ raw_text?: string }> | { raw_text?: string } | null;
    const raw = Array.isArray(sources) ? sources[0]?.raw_text : sources?.raw_text;
    return { id: x.id as string, title: (x.title as string) || 'Untitled', excerpt: excerptOf(raw) };
  });

  return { brand: brandFrom(publicBotId, bot.name, bot.appearance), articles };
}

/** Public (unauthenticated) single article. */
export async function getHelpCenterArticle(
  publicBotId: string,
  documentId: string,
): Promise<{ brand: HelpCenterBrand; article: ArticleDetail } | null> {
  const bot = await loadBotByPublicId(publicBotId);
  if (!bot || bot.assistantAudience === 'internal') return null;

  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('documents')
    .select('id,title,audience,status,document_sources(raw_text)')
    .eq('company_id', bot.companyId)
    .eq('id', documentId)
    .maybeSingle();
  if (!data) return null;
  const x = data as Record<string, unknown>;
  const audience = x.audience as string;
  if (audience !== 'customer' && audience !== 'both') return null;
  if (x.status !== 'ready') return null;

  const sources = x.document_sources as Array<{ raw_text?: string }> | { raw_text?: string } | null;
  const raw = (Array.isArray(sources) ? sources[0]?.raw_text : sources?.raw_text) ?? '';

  return {
    brand: brandFrom(publicBotId, bot.name, bot.appearance),
    article: { id: x.id as string, title: (x.title as string) || 'Untitled', excerpt: excerptOf(raw), content: raw },
  };
}
