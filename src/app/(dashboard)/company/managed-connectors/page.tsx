import { requireRole } from '@/lib/auth';
import { ROLES, CONNECTION_STATUS_LABELS, PROVIDER_LABELS, labelFor } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { formatDate } from '@/lib/format';
import { MANAGED_CREDENTIAL_FIELDS } from '@/lib/helpdesk/managed';
import { listManagedConnectors } from '@/modules/company/managed-connectors-data';
import { deleteManagedConnectorAction } from '@/modules/company/managed-connectors-actions';
import { ManagedConnectorForm } from '@/modules/company/components/managed-connector-form';
import { ConfirmSubmit } from '@/components/confirm-submit';

async function remove(formData: FormData) {
  'use server';
  await deleteManagedConnectorAction(formData);
}

export default async function ManagedConnectorsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const connectors = await listManagedConnectors();
  const fields = MANAGED_CREDENTIAL_FIELDS as Record<
    string,
    Array<{ key: string; label: string; required: boolean }>
  >;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        backTo={{ href: '/company/settings', label: 'Settings' }}
        title="Set up for you"
        description="If you use Shopify, Square or Foodics, paste one token and we do the rest of the connecting. Your assistant can then answer about live products, stock and sales without you keeping a second copy up to date."
      />

      {/* Desktop: what is connected on the left, the form that connects
          something else on the right. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-0">
              {connectors.length === 0 ? (
                <EmptyState
                  title="Nothing connected yet"
                  body="Connect Shopify, Square or Foodics above and the assistant starts answering from your live stock and sales straight away."
                />
              ) : (
                <ul className="divide-y">
                  {connectors.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{c.name}</span>
                          <Badge variant="outline">{labelFor(PROVIDER_LABELS, c.platform)}</Badge>
                          <Badge variant={c.status === 'active' ? 'success' : 'outline'}>
                            {labelFor(CONNECTION_STATUS_LABELS, c.status)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Connected {formatDate(c.createdAt)}
                        </p>
                      </div>
                      <form action={remove}>
                        <input type="hidden" name="connectorId" value={c.connectorId} />
                        <ConfirmSubmit
                          label="Disconnect"
                          confirmLabel="Yes, disconnect"
                          question="Your assistant stops being able to answer about live stock, prices and sales from this shop."
                        />
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
            <CardHeader>
              <CardTitle>Connect one now</CardTitle>
              <CardDescription>
                The assistant can only read from these — it can never change anything in your shop.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ManagedConnectorForm fields={fields} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
