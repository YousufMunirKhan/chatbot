import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CopyButton } from '@/components/copy-button';
import { listAgentInvites, listMembers, getCompanyId } from '@/modules/company/data';
import { removeAgentAction } from '@/modules/company/actions';
import { AgentInviteForm } from '@/modules/company/components/agent-invite-form';
import { setAgentPresenceAction } from '@/modules/company/agent-presence-actions';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { env } from '@/lib/env';

export default async function AgentsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [members, invites, companyId] = await Promise.all([listMembers(), listAgentInvites(), getCompanyId()]);
  const { data: company } = await createSupabaseServiceClient()
    .from('companies')
    .select('slug')
    .eq('id', companyId)
    .maybeSingle();
  const agentUrl = `${env.NEXT_PUBLIC_APP_URL}/c/${(company?.slug as string) ?? ''}/agent`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-muted-foreground">
          Company admins and agents. Agents handle the inbox and can take over from AI.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agent workspace link</CardTitle>
          <p className="text-sm text-muted-foreground">
            Share this link with your agents — they sign in once and land directly in the chat inbox. You (already
            signed in) go straight there, no extra login.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 overflow-auto rounded-md bg-muted px-3 py-2 text-sm">{agentUrl}</code>
            <div className="flex shrink-0 gap-2">
              <CopyButton value={agentUrl} label="Copy link" />
              <Button asChild size="sm">
                <Link href="/company/inbox">Open inbox</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My availability</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {['online', 'away', 'offline'].map((status) => (
            <form key={status} action={setAgentPresenceAction}>
              <input type="hidden" name="status" value={status} />
              <Button type="submit" variant="outline" size="sm">{status}</Button>
            </form>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add an agent</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentInviteForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invites</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    No invites yet.
                  </TableCell>
                </TableRow>
              ) : (
                invites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell>{invite.fullName ?? '—'}</TableCell>
                    <TableCell>{invite.email}</TableCell>
                    <TableCell>
                      <Badge variant={invite.acceptedAt ? 'success' : invite.revokedAt ? 'secondary' : 'warning'}>
                        {invite.acceptedAt ? 'accepted' : invite.revokedAt ? 'revoked' : 'pending'}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(invite.expiresAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Presence</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.membershipId}>
                  <TableCell>{m.fullName ?? '—'}</TableCell>
                  <TableCell>{m.email ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={m.role === 'company_admin' ? 'default' : 'secondary'}>
                      {m.role.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.presenceStatus === 'online' ? 'success' : m.presenceStatus === 'away' ? 'warning' : 'secondary'}>
                      {m.presenceStatus ?? 'offline'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {m.role === 'agent' ? (
                      <form action={removeAgentAction}>
                        <input type="hidden" name="membershipId" value={m.membershipId} />
                        <Button type="submit" variant="ghost" size="sm">
                          Remove
                        </Button>
                      </form>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
