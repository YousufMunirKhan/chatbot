import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { companyLabel } from '@/lib/labels';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { formatDate, formatNumber } from '@/lib/format';
import { getDocumentForEdit } from '@/modules/company/knowledge-data';
import { listBots } from '@/modules/company/data';
import { KnowledgeDocumentForm } from '@/modules/company/components/knowledge-document-form';

/**
 * Edit one knowledge document.
 *
 * WHY THIS IS ITS OWN PAGE, when services, policies and FAQs are edited inline
 * on the Business Data table: those records are a few hundred characters each.
 * A knowledge document is up to 750,000, and a company may hold 400 of them, so
 * putting the source text into a `<details>` on that table would ship megabytes
 * of textarea to every admin who opened the Knowledge tab to read six titles.
 * The text is fetched here, one document at a time, by the owner who asked for
 * it.
 *
 * The back link returns to the Knowledge tab specifically — `BusinessDataTabs`
 * reads the tab from `?tab=`, so landing back on Overview after saving would
 * make the owner re-find where they were.
 */

export const dynamic = 'force-dynamic';

const BACK_TO_KNOWLEDGE = '/company/business-data?tab=knowledge';

export default async function KnowledgeDocumentPage({ params }: { params: { id: string } }) {
  await requireRole([ROLES.COMPANY_ADMIN]);

  // `getDocumentForEdit` is scoped to the session's company, so a document
  // belonging to another tenant is indistinguishable from one that never
  // existed.
  const [doc, bots] = await Promise.all([getDocumentForEdit(params.id), listBots()]);
  if (!doc) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        backTo={{ href: BACK_TO_KNOWLEDGE, label: 'My business info' }}
        title={doc.title}
        description={
          <>
            <Badge variant="secondary">{companyLabel('documentStatus', doc.status)}</Badge>{' '}
            {formatNumber(doc.charCount)} characters · added {formatDate(doc.createdAt)} ·{' '}
            {doc.botName ? `used by ${doc.botName}` : 'used by every assistant'}
          </>
        }
      />

      {doc.editRefusal ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            {/* Said out loud, on the screen the owner arrived at expecting a
                form. Refusing silently — or hiding the control — leaves them
                deleting the document and adding it again, which is the exact
                loss of history this feature exists to prevent. */}
            <Alert tone="info" title="This document cannot be edited here">
              <p className="text-sm leading-6">{doc.editRefusal}</p>
            </Alert>
            {doc.sourceUrl ? (
              <p className="break-all text-sm text-muted-foreground">
                Imported from{' '}
                <a
                  href={doc.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  {doc.sourceUrl}
                </a>
              </p>
            ) : null}
            <Button asChild size="sm" variant="outline">
              <Link href={BACK_TO_KNOWLEDGE}>Back to knowledge</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {doc.truncated ? (
            <Alert tone="warning" title="Not all of the original was indexed">
              <p className="text-sm leading-6">
                {doc.truncationReason ??
                  'Part of this document was longer than we index, so it was left out.'}{' '}
                What you see below is everything your assistant actually has. Saving replaces it
                with exactly what is in the box.
              </p>
            </Alert>
          ) : null}

          <Card>
            <CardContent className="p-6">
              <KnowledgeDocumentForm
                doc={{ id: doc.id, title: doc.title, text: doc.text, botId: doc.botId }}
                bots={bots.map((bot) => ({ id: bot.id, name: bot.name }))}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
