import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { INVITE_STATUS_LABELS, PRESENCE_LABELS, ROLES, labelFor } from '@/lib/constants';
import { companyLabel } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CopyButton } from '@/components/copy-button';
import { listAgentInvites, listMembers, getCompanyId } from '@/modules/company/data';
import { removeAgentAction } from '@/modules/company/actions';
import { AgentInviteForm } from '@/modules/company/components/agent-invite-form';
import { setAgentPresenceAction } from '@/modules/company/agent-presence-actions';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { env } from '@/lib/env';
import { formatDate } from '@/lib/format';
import { ConfirmSubmit } from '@/components/confirm-submit';

export default async function AgentsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [members, invites, companyId] = await Promise.all([
    listMembers(),
    listAgentInvites(),
    getCompanyId(),
  ]);
  const { data: company } = await createSupabaseServiceClient()
    .from('companies')
    .select('slug')
    .eq('id', companyId)
    .maybeSingle();
  const agentUrl = `${env.NEXT_PUBLIC_APP_URL}/c/${(company?.slug as string) ?? ''}/agent`;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Team"
        description="The people who can sign in. Owners can change everything; staff work the inbox and can step into a chat when the assistant cannot finish it."
      />

      <Card>
        <CardHeader>
          <CardTitle>Sign-in link for your staff</CardTitle>
          <p className="text-sm text-muted-foreground">
            Send this to anyone you have invited. They sign in once and land straight in the chat
            inbox — they never see billing, settings or your assistant&rsquo;s setup.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 overflow-auto rounded-md bg-muted px-3 py-2 text-sm">
              {agentUrl}
            </code>
            <div className="flex shrink-0 gap-2">
              <CopyButton value={agentUrl} label="Copy link" />
              <Button asChild size="sm">
                <Link href="/company/inbox">Open inbox</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Desktop: who is already here on the left, the two things you do to
          that list on the right. Stacked, the members table — the reason you
          opened the page — sat below two small cards and a form. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Everyone who can sign in</CardTitle>
              <CardDescription>
                What each person can do, and whether they are at their desk right now.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>What they can do</TableHead>
                    <TableHead>At their desk</TableHead>
                    <TableHead>
                      {/* Column of row actions. Named for screen readers only —
                          a visible heading over two buttons is noise. */}
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.membershipId}>
                      <TableCell>{m.fullName ?? '—'}</TableCell>
                      <TableCell>{m.email ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={m.role === 'company_admin' ? 'default' : 'secondary'}>
                          {companyLabel('role', m.role)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            m.presenceStatus === 'online'
                              ? 'success'
                              : m.presenceStatus === 'away'
                                ? 'warning'
                                : 'secondary'
                          }
                        >
                          {labelFor(PRESENCE_LABELS, m.presenceStatus ?? 'offline')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        {m.role === 'agent' ? (
                          <form action={removeAgentAction}>
                            <input type="hidden" name="membershipId" value={m.membershipId} />
                            <ConfirmSubmit
                              label="Remove from the team"
                              confirmLabel="Yes, remove them"
                              question={`${m.fullName || m.email || 'This person'} is signed out immediately and can no longer open your inbox or see any customer details. Chats they already replied to are kept.`}
                            />
                          </form>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invitations you have sent</CardTitle>
              <CardDescription>
                People stay on this list until they open the email and set a password.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Where it got to</TableHead>
                    <TableHead>Invitation expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={4} className="p-0">
                        {/* Module 1 — the invite form sits beside this, so no button here. */}
                        <EmptyState
                          title="You have not invited anyone yet."
                          body="Invite a teammate using the form beside this and they stay on this list until they accept."
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    invites.map((invite) => (
                      <TableRow key={invite.id}>
                        <TableCell>{invite.fullName ?? '—'}</TableCell>
                        <TableCell>{invite.email}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              invite.acceptedAt
                                ? 'success'
                                : invite.revokedAt
                                  ? 'secondary'
                                  : 'warning'
                            }
                          >
                            {labelFor(
                              INVITE_STATUS_LABELS,
                              invite.acceptedAt
                                ? 'accepted'
                                : invite.revokedAt
                                  ? 'revoked'
                                  : 'pending',
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDate(invite.expiresAt)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Sticky on desktop: you invite someone while reading the list of who
            is already there, so the form must stay in view as that list grows. */}
        <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Invite someone to the team</CardTitle>
              <CardDescription>
                They get an email with a link to set their own password. Nothing is shared with them
                until they accept.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AgentInviteForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Am I at my desk?</CardTitle>
              <CardDescription>
                Tells your team whether to send a chat your way. It does not stop chats reaching you
                — it only changes what the rest of the team sees beside your name.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Set my status to</legend>
                <div className="flex flex-wrap gap-2">
                  {(['online', 'away', 'offline'] as const).map((status) => (
                    <form key={status} action={setAgentPresenceAction}>
                      <input type="hidden" name="status" value={status} />
                      <Button type="submit" variant="outline" size="sm">
                        {labelFor(PRESENCE_LABELS, status)}
                      </Button>
                    </form>
                  ))}
                </div>
              </fieldset>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
