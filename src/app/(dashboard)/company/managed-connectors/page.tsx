import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { MANAGED_CREDENTIAL_FIELDS } from '@/lib/helpdesk/managed';
import { listManagedConnectors } from '@/modules/company/managed-connectors-data';
import { deleteManagedConnectorAction } from '@/modules/company/managed-connectors-actions';
import { ManagedConnectorForm } from '@/modules/company/components/managed-connector-form';

async function remove(formData: FormData) {
  'use server';
  await deleteManagedConnectorAction(formData);
}

export default async function ManagedConnectorsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const connectors = await listManagedConnectors();
  const fields = MANAGED_CREDENTIAL_FIELDS as Record<string, Array<{ key: string; label: string; required: boolean }>>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/company/help-desk" className="text-sm text-muted-foreground hover:underline">
          ← Help Desk
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Managed connectors</h1>
        <p className="text-sm text-muted-foreground">
          Connect Shopify, Square, or Foodics by pasting a token — no SDK to deploy. The assistant queries them
          server-side for live product, stock, and sales answers.
        </p>
      </div>

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
            <p className="p-6 text-sm text-muted-foreground">No managed connectors yet.</p>
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
                    <Button type="submit" variant="ghost" size="sm">
                      Disconnect
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
