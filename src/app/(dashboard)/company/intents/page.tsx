import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { getNluSettings, listIntents } from '@/modules/company/flows-data';
import { deleteIntentAction } from '@/modules/company/flows-actions';
import {
  IntentEditor,
  IntentTester,
  NluSettingsForm,
} from '@/modules/company/components/intents-panel';

export const dynamic = 'force-dynamic';

async function removeIntent(formData: FormData) {
  'use server';
  await deleteIntentAction(formData);
}

export default async function IntentsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [intents, settings] = await Promise.all([listIntents(), getNluSettings()]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Trigger phrases"
        description="Customers ask the same thing a dozen different ways — “where’s my order”, “has it shipped”, “tracking please”. Group them here and one guided chat can start on all of them."
        backTo={{ href: '/company/flows', label: 'Guided chats' }}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/company/flows">Back to flows</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Your intents</CardTitle>
          <CardDescription>
            Point a flow trigger at one of these and it runs whenever a message means the same thing.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {intents.length === 0 ? (
            <EmptyState
              title="No intents yet"
              body="Without intents, a flow can only start on an exact keyword. Add one below with a handful of real customer phrasings and the assistant will recognise the rest."
            />
          ) : (
            <ul className="divide-y">
              {intents.map((intent) => (
                <li key={intent.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{intent.name}</span>
                      <Badge variant={intent.isActive ? 'success' : 'outline'}>
                        {intent.isActive ? 'Active' : 'Off'}
                      </Badge>
                      <Badge variant="outline">{intent.examples.length} examples</Badge>
                    </div>
                    {intent.description ? (
                      <p className="text-sm text-muted-foreground">{intent.description}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-1">
                      {intent.examples.slice(0, 6).map((example) => (
                        <span key={example} className="rounded-full border bg-muted px-2 py-0.5 text-xs">
                          {example}
                        </span>
                      ))}
                      {intent.examples.length > 6 ? (
                        <span className="text-xs text-muted-foreground">
                          +{intent.examples.length - 6} more
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <form action={removeIntent}>
                    <input type="hidden" name="id" value={intent.id} />
                    <ConfirmSubmit
                      label="Delete"
                      question="Flows triggered by this intent will stop starting."
                    />
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <IntentEditor intents={intents} />
        <div className="space-y-6">
          <NluSettingsForm settings={settings} />
          <IntentTester />
        </div>
      </div>
    </div>
  );
}
