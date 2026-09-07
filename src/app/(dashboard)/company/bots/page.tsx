import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listBots } from '@/modules/company/data';
import { formatDate } from '@/lib/format';
import { companyLabel } from '@/lib/labels';

function assistantTypeHint(audience: string) {
  return audience === 'internal'
    ? 'Helps your team with how-to questions and looking things up'
    : 'Answers visitors on your website and takes their details';
}

export default async function BotsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const bots = await listBots();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="My assistants"
        description={
          bots.length === 0
            ? 'An assistant is the thing that talks to people for you. Most shops need one, for customers.'
            : `You have ${bots.length}. One can answer your customers, another can answer your own staff.`
        }
        actions={
          <Button asChild>
            <Link href="/company/bots/new">New assistant</Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>What it can help with</TableHead>
                <TableHead>Replying</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bots.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="p-0">
                    <EmptyState
                      title="No assistants yet"
                      body="An assistant answers your customers on your website and on WhatsApp, day and night, using what you tell it about your business. Most shops only ever need one."
                      action={
                        <Button asChild size="sm">
                          <Link href="/company/bots/new">Create my assistant</Link>
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                bots.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="font-medium">{b.name}</div>
                      <div className="text-xs text-muted-foreground">{assistantTypeHint(b.assistantAudience)}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={b.assistantAudience === 'internal' ? 'warning' : 'secondary'}>
                        {companyLabel('assistantAudience', b.assistantAudience)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {/* A bare count told the owner nothing. Name the first two
                          things it actually does, then count the rest. */}
                      {b.capabilityFlags.length === 0 ? (
                        <span className="text-sm text-muted-foreground">Nothing turned on yet</span>
                      ) : (
                        <span className="text-sm">
                          {b.capabilityFlags
                            .slice(0, 2)
                            .map((flag) => companyLabel('capability', flag))
                            .join(', ')}
                          {b.capabilityFlags.length > 2
                            ? ` and ${b.capabilityFlags.length - 2} more`
                            : ''}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{b.aiEnabled ? 'On' : 'Off'}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(b.createdAt)}</TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-3">
                        {b.assistantAudience === 'internal' ? (
                          <Link href="/company/help-desk" className="text-sm text-primary hover:underline">
                            Help Desk
                          </Link>
                        ) : (
                          <Link href="/company/widget" className="text-sm text-primary hover:underline">
                            Widget
                          </Link>
                        )}
                        <Link href={`/company/bots/${b.id}/settings`} className="text-sm text-primary hover:underline">
                          Settings
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
