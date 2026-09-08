import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSessionUser } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/db/server';

/**
 * Keep tenant workspaces out of the index.
 *
 * This route is public and renders the company's own name in its heading, so
 * every tenant that exists is a crawlable page announcing that they are a
 * customer. Indexed, that publishes the customer list and fills the index with
 * near-duplicate pages a searcher can do nothing with.
 *
 * `robots.txt` disallows `/c/` as well. Both are wanted and they do different
 * jobs: the disallow saves the crawl entirely, while this tag covers the case
 * where the URL is reached from a link somewhere else — a disallowed page can
 * still be indexed from an external link, and only the tag prevents that.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function CompanyAgentEntryPage({ params }: { params: { slug: string } }) {
  const sb = createSupabaseServiceClient();
  const { data: company } = await sb
    .from('companies')
    .select('id,name,status')
    .eq('slug', params.slug)
    .maybeSingle();
  if (!company) notFound();

  const user = await getSessionUser();
  if (user && user.companyId === company.id && (user.role === 'agent' || user.role === 'company_admin')) {
    redirect('/company/inbox');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{company.name} agent workspace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {company.status === 'suspended' ? (
            <p className="text-sm text-destructive">This company workspace is currently suspended.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Sign in with your agent email and password to handle live chats for this company.
              </p>
              <Button asChild className="w-full">
                <Link href="/login">Agent login</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
