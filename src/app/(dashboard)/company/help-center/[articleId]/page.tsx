import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/relative-time';
import { helpCenterOrigin } from '@/modules/help-center/data';
import { getHelpArticleForEdit } from '@/modules/help-center/help-center-data';
import {
  ArticleEditorForm,
  ArticleStateControls,
} from '@/modules/help-center/components/help-center-forms';

/**
 * Write, preview, publish.
 *
 * The read is scoped to the session user's company, so an article id from
 * another tenant is a 404 rather than a page — `getHelpArticleForEdit` returns
 * null and nothing here has to remember to check.
 */

export const dynamic = 'force-dynamic';

export default async function HelpArticleEditorPage({
  params,
}: {
  params: { articleId: string };
}) {
  const user = await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const article = await getHelpArticleForEdit(params.articleId);
  if (!article) notFound();

  const canPublish = user.role === ROLES.COMPANY_ADMIN || user.isSuperAdmin;

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: '/company/help-center', label: 'Help centre' }}
        title={article.title || 'Untitled'}
        description={
          article.status === 'published'
            ? `Published ${article.publishedAt ? formatRelativeTime(article.publishedAt) : ''} · edited ${formatRelativeTime(article.updatedAt)}`
            : `Draft · edited ${formatRelativeTime(article.updatedAt)}`
        }
        actions={
          <>
            {article.status === 'published' ? (
              <Badge variant={article.indexed ? 'success' : 'warning'}>
                {article.indexed ? 'Live' : 'Live, not taught'}
              </Badge>
            ) : (
              <Badge variant="secondary">Draft</Badge>
            )}
            {article.status === 'published' && article.publicUrl && article.helpCenterIsPublic ? (
              <Button asChild variant="outline" size="sm">
                <a href={article.publicUrl} target="_blank" rel="noreferrer">
                  View live
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-6">
            <ArticleEditorForm
              articleId={article.id}
              title={article.title}
              slug={article.slug}
              excerpt={article.excerpt}
              body={article.body}
              categoryId={article.categoryId}
              seoTitle={article.seoTitle}
              seoDescription={article.seoDescription}
              categories={article.categories}
              origin={helpCenterOrigin()}
              handle={article.publicHandle}
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publishing</CardTitle>
              <CardDescription>
                {article.status !== 'published' ? (
                  'Only your team can see this.'
                ) : article.helpCenterIsPublic ? (
                  'Customers can read this, and the assistant answers from it.'
                ) : (
                  // Published, but nobody can reach it: two states that both
                  // said "Customers can read this" before, one of them wrongly.
                  <>
                    The assistant answers from this, but your help centre is switched off, so the
                    page itself is not reachable.{' '}
                    <Link href="/company/help-center" className="underline underline-offset-2">
                      Turn it back on
                    </Link>
                    .
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ArticleStateControls
                articleId={article.id}
                status={article.status}
                indexed={article.indexed}
                canPublish={canPublish}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>Last edited {formatAbsoluteTime(article.updatedAt)}</p>
              <p>
                {article.publishedAt
                  ? `First published ${formatAbsoluteTime(article.publishedAt)}`
                  : 'Never published'}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
