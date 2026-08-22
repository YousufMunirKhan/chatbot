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
        description="Reusable replies agents can insert into any conversation with one click."
      />

      <Card>
        <CardContent className="p-4">
          <CannedResponseForm />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {canned.length === 0 ? (
            <EmptyState title="No saved replies yet." />
          ) : (
            <ul className="divide-y">
              {canned.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="font-medium">{c.title}</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{c.body}</p>
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
  );
}
