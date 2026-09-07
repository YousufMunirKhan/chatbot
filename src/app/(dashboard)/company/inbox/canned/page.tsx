import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { listCannedResponses } from '@/modules/company/inbox-data';
import { deleteCannedResponseAction } from '@/modules/company/inbox-actions';
import { CannedResponseForm } from '@/modules/company/components/canned-response-form';
import { ConfirmSubmit } from '@/components/confirm-submit';

async function handleDelete(formData: FormData) {
  'use server';
  await deleteCannedResponseAction(formData);
}

export default async function CannedResponsesPage() {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const canned = await listCannedResponses();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        backTo={{ href: '/company/inbox', label: 'Inbox' }}
        title="Saved replies"
        description="The answers your team types over and over. Save one here and anybody can drop it into a chat with one click, worded the same way every time."
      />

      {/* Desktop: the replies you have saved on the left, the form that
          saves another on the right. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-0">
              {canned.length === 0 ? (
                <EmptyState
                  title="Nothing saved yet"
                  body="Think of the three things you type most — your address, your delivery times, how to return something. Save those first and your team stops rewriting them."
                />
              ) : (
                <ul className="divide-y">
                  {canned.map((c) => (
                    <li key={c.id} className="flex items-start justify-between gap-4 p-4">
                      <div className="min-w-0">
                        <p className="font-medium">{c.title}</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
                          {c.body}
                        </p>
                      </div>
                      <form action={handleDelete}>
                        <input type="hidden" name="id" value={c.id} />
                        <ConfirmSubmit label="Delete" question="This cannot be undone." />
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sticky on desktop: you fill this in while reading the list
            beside it, so it must not scroll away with that list. */}
        <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardContent className="p-4">
              <CannedResponseForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
