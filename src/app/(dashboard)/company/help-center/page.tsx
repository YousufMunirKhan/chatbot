import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { formatRelativeTime } from '@/lib/relative-time';
import { helpCenterOrigin } from '@/modules/help-center/data';
import { getHelpCenterOverview, type HelpArticleRow } from '@/modules/help-center/help-center-data';
import {
  ArticleMoveButtons,
  CategoryRow,
  HelpCenterSettingsForm,
  NewArticleForm,
  NewCategoryForm,
} from '@/modules/help-center/components/help-center-forms';

/**
 * Help centre — the writing desk.
 *
 * Everything a customer can read is made here: the sections they browse, the
 * articles inside them, and the address the whole thing lives at. Drafts are
 * listed alongside published articles because that is the point of the page —
 * the public side never sees them.
 *
 * Agents reach this screen too. They can write and edit; the Publish, Delete,
 * section and address controls are administrator-only, and the server actions
 * enforce that independently of what is rendered here.
 */

export const dynamic = 'force-dynamic';

function StatusBadge({ article }: { article: HelpArticleRow }) {
  if (article.status !== 'published') return <Badge variant="secondary">Draft</Badge>;
  return article.indexed ? (
    <Badge variant="success">Live</Badge>
  ) : (
    // Published but not embedded: readers can see it, the assistant cannot
    // quote it. Two different states that a single "Live" badge would hide.
    <Badge variant="warning">Live, not taught</Badge>
  );
}

function ArticleLine({
  article,
  isFirst,
  isLast,
}: {
  article: HelpArticleRow;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-t px-4 py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <Link
          href={`/company/help-center/${article.id}`}
          className="text-sm font-medium hover:underline"
        >
          {article.title}
        </Link>
        {article.excerpt ? (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{article.excerpt}</p>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground">
        edited {formatRelativeTime(article.updatedAt)}
      </span>
      <StatusBadge article={article} />
      <ArticleMoveButtons id={article.id} isFirst={isFirst} isLast={isLast} />
    </li>
  );
}

export default async function HelpCenterPage() {
  const user = await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const isAdmin = user.role === ROLES.COMPANY_ADMIN || user.isSuperAdmin;
  const overview = await getHelpCenterOverview();
  const origin = helpCenterOrigin();

  // Grouped the way the reader sees them, so "move up" on this page and the
  // order on the public page are the same list.
  const grouped = overview.categories.map((category) => ({
    id: category.id,
    name: category.name,
    articles: overview.articles.filter((a) => a.categoryId === category.id),
  }));
  const loose = overview.articles.filter((a) => !a.categoryId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Help centre"
        description="Answers your customers can read for themselves — and that your assistant can quote."
        actions={
          overview.publicUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={overview.publicUrl} target="_blank" rel="noreferrer">
                View live
              </a>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Published" value={String(overview.publishedCount)} />
        <StatTile label="Drafts" value={String(overview.draftCount)} />
        <StatTile label="Sections" value={String(overview.categories.length)} />
      </div>

      {!overview.settings.isPublished ? (
        <Card className="border-warning-border bg-warning-bg">
          <CardContent className="p-4 text-sm text-warning-fg">
            Your help centre is switched off. Readers get “not found” until you turn it back on below.
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Articles</CardTitle>
          <CardDescription>
            New articles start as drafts. Nothing reaches your customers, or your assistant, until it is
            published.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <NewArticleForm categories={overview.categories.map((c) => ({ id: c.id, name: c.name }))} />

          {overview.articles.length === 0 ? (
            <EmptyState
              title="No articles yet"
              body="Start with the question your customers ask most. One good answer deflects it for everybody after them."
            />
          ) : (
            <div className="space-y-5">
              {grouped
                .filter((group) => group.articles.length > 0)
                .map((group) => (
                  <div key={group.id}>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {group.name}
                    </p>
                    <ul className="rounded-md border">
                      {group.articles.map((article, i) => (
                        <ArticleLine
                          key={article.id}
                          article={article}
                          isFirst={i === 0}
                          isLast={i === group.articles.length - 1}
                        />
                      ))}
                    </ul>
                  </div>
                ))}

              {loose.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    No section
                  </p>
                  <ul className="rounded-md border">
                    {loose.map((article, i) => (
                      <ArticleLine
                        key={article.id}
                        article={article}
                        isFirst={i === 0}
                        isLast={i === loose.length - 1}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Sections</CardTitle>
            <CardDescription>
              How readers browse. A section with no published articles is hidden from the public page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <NewCategoryForm />
            {overview.categories.length === 0 ? (
              <EmptyState
                title="No sections yet"
                body="Once you have more than a handful of articles, sections are what stop the page becoming a scroll."
              />
            ) : (
              <div className="space-y-3">
                {overview.categories.map((category, i) => (
                  <CategoryRow
                    key={category.id}
                    id={category.id}
                    name={category.name}
                    description={category.description}
                    articleCount={category.articleCount}
                    isFirst={i === 0}
                    isLast={i === overview.categories.length - 1}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Public page</CardTitle>
            <CardDescription>
              {overview.publicUrl ? (
                <>
                  Live at{' '}
                  <a
                    href={overview.publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    {overview.publicUrl}
                  </a>
                  {overview.usingBotId
                    ? ' — that is your assistant id. A short web address below is easier to share and reads better in search results.'
                    : null}
                </>
              ) : (
                'Create an assistant, or set a web address below, and your help centre gets a public page.'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HelpCenterSettingsForm
              slug={overview.settings.slug}
              title={overview.settings.title}
              description={overview.settings.description}
              isPublished={overview.settings.isPublished}
              origin={origin}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
