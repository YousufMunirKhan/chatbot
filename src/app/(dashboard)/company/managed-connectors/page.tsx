import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
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
  const fields = MANAGED_CREDENTIAL_FIELDS as Record<string, Array<{ key: string; label: string; required: boolean }>>;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        backTo={{ href: '/company/help-desk', label: 'Help Desk' }}
        title="Managed connectors"
        description="Connect Shopify, Square, or Foodics by pasting a token — no SDK to deploy. The assistant queries them server-side for live product, stock, and sales answers."
      />

      <Card>
        <CardHeader>
          <CardTitle>Connect a platform</CardTitle>
          <CardDescription>Read-only actions are enabled automatically once connected.</CardDescription>
        </CardHeader>
        <CardContent>
          <ManagedConnectorForm fields={fields} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {connectors.length === 0 ? (
            <EmptyState title="No managed connectors yet." />
          ) : (
            <ul className="divide-y">
              {connectors.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      <Badge variant="outline" className="capitalize">{c.platform}</Badge>
                      <Badge variant={c.status === 'active' ? 'success' : 'outline'}>{c.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">Connected {formatDate(c.createdAt)}</p>
                  </div>
                  <form action={remove}>
                    <input type="hidden" name="connectorId" value={c.connectorId} />
                    <ConfirmSubmit label="Disconnect" confirmLabel="Yes, disconnect" question="The assistant loses live access to this system." />
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
