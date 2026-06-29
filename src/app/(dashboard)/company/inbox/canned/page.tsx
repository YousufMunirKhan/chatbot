import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { listCannedResponses } from '@/modules/company/inbox-data';
import { deleteCannedResponseAction } from '@/modules/company/inbox-actions';
import { CannedResponseForm } from '@/modules/company/components/canned-response-form';

async function handleDelete(formData: FormData) {
  'use server';
  await deleteCannedResponseAction(formData);
}

export default async function CannedResponsesPage() {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const canned = await listCannedResponses();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/company/inbox" className="text-sm text-muted-foreground hover:underline">
          ← Inbox
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Saved replies</h1>
        <p className="text-sm text-muted-foreground">
          Reusable replies agents can insert into any conversation with one click.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <CannedResponseForm />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {canned.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No saved replies yet.</p>
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
                    <Button type="submit" variant="ghost" size="sm">
                      Delete
                    </Button>
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
