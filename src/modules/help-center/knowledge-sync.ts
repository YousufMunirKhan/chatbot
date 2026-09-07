import { createSupabaseServiceClient } from '@/lib/db/server';
import { ingestKnowledge } from '@/lib/knowledge/ingest-queue';
import { logger } from '@/lib/logger';
import { toPlainText } from './markdown';

/**
 * Published articles → the assistant's knowledge index.
 *
 * A help centre that the assistant cannot quote is half a product: the customer
 * who asks the chat "how do I return this?" gets "I don't know" while the
 * answer sits two clicks away on the same site. So publishing an article
 * indexes it, and withdrawing one removes it.
 *
 * HOW IT ATTACHES
 * `ingestKnowledge` is the existing front door (0075) and it upserts on
 * `(company_id, source_url)`. Giving each article the stable synthetic source
 * `help-article:<id>` makes re-publishing an UPDATE of the same document rather
 * than a second copy, and it survives a renamed slug, a moved category and a
 * rewritten title — none of which change the id. It also gives the public page
 * and the search function one marker to exclude these documents by, so an
 * article never appears twice under two names.
 *
 * `botId` is null on purpose: `match_chunks` treats a null-bot chunk as
 * company-wide (`p_bot_id is null or c.bot_id = p_bot_id or c.bot_id is null`),
 * so one article answers on the website widget, WhatsApp and every other
 * assistant the company runs. `audience` is 'customer' because this text is
 * already published to the public internet.
 *
 * FAILURE IS NOT FATAL
 * Indexing costs an embedding round trip to a provider that can be down, rate
 * limited or unconfigured. Losing that must not lose the publish — the article
 * is public either way, and the dashboard shows whether the assistant has it
 * yet — so every function here reports failure by returning rather than
 * throwing, and the writer gets a "Re-index" button instead of a red page.
 */

export function knowledgeSourceFor(articleId: string): string {
  return `help-article:${articleId}`;
}

export interface ArticleForIndex {
  id: string;
  title: string;
  excerpt: string | null;
  body: string;
}

/**
 * Index (or re-index) one article. Returns the knowledge document id, or null
 * when the embedding provider refused — the caller stores whichever it gets.
 */
export async function syncArticleToKnowledge(
  companyId: string,
  article: ArticleForIndex,
): Promise<string | null> {
  // The reader gets Markdown; the retriever gets prose. Leaving the markup in
  // puts `**` and `](` inside the embedded vector and inside the sentences the
  // assistant quotes back at a customer.
  const summary = (article.excerpt ?? '').trim();
  const text = [article.title, summary, toPlainText(article.body)].filter(Boolean).join('\n\n').trim();

  if (!text) {
    // Nothing to embed. Not an error — an article can legitimately be published
    // as a stub — but there is no document to point at.
    return null;
  }

  try {
    const { documentId } = await ingestKnowledge({
      companyId,
      botId: null,
      title: article.title || 'Untitled',
      text,
      sourceType: 'text',
      sourceUrl: knowledgeSourceFor(article.id),
      audience: 'customer',
    });
    return documentId;
  } catch (err) {
    logger.error('Could not index help article for the assistant', {
      companyId,
      module: 'help-center',
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Withdraw an article from the index. Deleting the document cascades to its
 * chunks (0006), which is what actually stops the assistant quoting it — an
 * unpublished article that the chat still recites is the same leak as a visible
 * draft.
 */
export async function removeArticleFromKnowledge(companyId: string, articleId: string): Promise<void> {
  try {
    await createSupabaseServiceClient()
      .from('documents')
      .delete()
      .eq('company_id', companyId) // tenant boundary
      .eq('source_url', knowledgeSourceFor(articleId));
  } catch (err) {
    logger.error('Could not withdraw help article from the index', {
      companyId,
      module: 'help-center',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
