import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { INVITE_STATUS_LABELS, PRESENCE_LABELS, ROLES, labelFor } from '@/lib/constants';
import {
  ASSIGNABLE_ROLES,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  ROLE_PERMISSIONS,
  getEffectivePermissions,
  requirePermissionPage,
} from '@/lib/permissions';
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
import { AgentInviteForm } from '@/modules/company/components/agent-invite-form';
import { AgentAccessForm } from '@/modules/company/components/agent-access-form';
import type {
  AccessGroupOption,
  AccessRoleOption,
} from '@/modules/company/components/agent-access-fields';
import { setAgentPresenceAction } from '@/modules/company/agent-presence-actions';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { env } from '@/lib/env';
import { formatDate } from '@/lib/format';
import { RemoveAgentForm } from '@/modules/company/components/remove-agent-form';

/**
 * One sentence per role, in the words an owner would use. `companyLabel('role')`
 * already owns the NAME of each role ("Owner", "Team member") and this page is
 * not allowed to invent a second one, so only the explanation lives here.
 */
const ROLE_DESCRIPTIONS: Record<string, string> = {
  [ROLES.COMPANY_ADMIN]:
    'Can change everything — settings, billing, your assistant and who else is on the team.',
  [ROLES.AGENT]:
    'Works the inbox and looks customers up. Nothing that configures the product or costs money.',
};

/** Two or three examples, then "and N more" — a table cell cannot list nineteen. */
function summarisePermissions(keys: readonly string[]): string {
  if (keys.length === 0) return 'Nothing yet';
  const shown = keys.slice(0, 2).map((key) => PERMISSION_LABELS[key as keyof typeof PERMISSION_LABELS] ?? key);
  const rest = keys.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
}

export default async function AgentsPage() {
  const user = await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  // The gate is the permission, not the role. An owner holds `agents.manage` by
  // default so nothing changes for them; a team member an owner has explicitly
  // trusted with the team now reaches this page, and anybody else is sent to
  // their own home exactly as `requireRole` would have sent them.
  await requirePermissionPage('agents.manage');

  const [members, invites, companyId, held] = await Promise.all([
    listMembers(),
    listAgentInvites(),
    getCompanyId(),
    getEffectivePermissions(),
  ]);
  const { data: company } = await createSupabaseServiceClient()
    .from('companies')
    .select('slug')
    .eq('id', companyId)
    .maybeSingle();
  const agentUrl = `${env.NEXT_PUBLIC_APP_URL}/c/${(company?.slug as string) ?? ''}/agent`;

  // Everything the two client forms need, as plain serializable data.
  // `src/lib/permissions.ts` reads the session and the service-role client, so a
  // `'use client'` module can never import it — the server side hands it over.
  const manageable = [...held];
  const roleOptions: AccessRoleOption[] = ASSIGNABLE_ROLES
    // You may only hand out a role you hold yourself, so a team member with
    // `agents.manage` is not offered "Owner". The server enforces the same rule.
    .filter((role) => role === ROLES.AGENT || user.role === ROLES.COMPANY_ADMIN)
    .map((role) => ({
      value: role,
      label: companyLabel('role', role),
      description: ROLE_DESCRIPTIONS[role] ?? '',
      defaults: [...ROLE_PERMISSIONS[role]],
    }));
  const groupOptions: AccessGroupOption[] = PERMISSION_GROUPS.map((group) => ({
    key: group.key,
    group: group.group,
    permissions: group.permissions.map((key) => ({
      key,
      label: PERMISSION_LABELS[key],
      description: PERMISSION_DESCRIPTIONS[key],
    })),
  }));
  const defaultRole = roleOptions.some((r) => r.value === ROLES.AGENT)
    ? ROLES.AGENT
    : (roleOptions[0]?.value ?? ROLES.AGENT);

  // Read out of the list already fetched above — no extra query. The presence
  // card used to offer three identical buttons and never say which was on.
  const myPresence = members.find((m) => m.userId === user.userId)?.presenceStatus ?? 'offline';

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Team"
        description="The people who can sign in, and exactly what each of them can reach. Owners can change everything; everyone else gets the parts of the product you tick."
      />

      <Card>
        <CardHeader>
          <CardTitle>Sign-in link for your staff</CardTitle>
          {/* Was a bare `<p className="text-sm text-muted-foreground">`, which is
              `CardDescription` written out by hand — same result, one more place
              the two can drift apart. */}
          <CardDescription>
            Send this to anyone you have invited. They sign in once and land straight in the chat
            inbox — they never see billing, settings or your assistant&rsquo;s setup.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* `overflow-x-auto` and not `overflow-auto`: this is a single line
                of text that must never introduce a vertical scrollbar, and it
                must never widen the page — the URL carries a company slug and
                is long on a phone. */}
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-muted px-3 py-2 text-sm">
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
                  {members.map((m) => {
                    // Your own row never offers either control. Nobody may raise
                    // their own role or take their own access away, and the
                    // honest way to say that is to not draw the button — the
                    // server refuses it either way.
                    const isSelf = m.userId === user.userId;
                    return (
                      <TableRow key={m.membershipId}>
                        <TableCell>
                          {m.fullName ?? '—'}
                          {isSelf ? (
                            <span className="ms-2 text-xs text-muted-foreground">(you)</span>
                          ) : null}
                        </TableCell>
                        <TableCell>{m.email ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={m.role === ROLES.COMPANY_ADMIN ? 'default' : 'secondary'}>
                            {companyLabel('role', m.role)}
                          </Badge>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {summarisePermissions(m.permissions)}
                          </span>
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
                        <TableCell className="align-top">
                          {isSelf ? null : (
                            // `items-end` and `flex-col`, not a stack of block
                            // elements: the two controls are different widths
                            // and left-aligned they read as a ragged column.
                            // `ConfirmSubmit` grows to three controls when it
                            // arms, so the wrapper has to be allowed to wrap
                            // rather than force the column wider.
                            <div className="flex flex-col items-end gap-2">
                              <AgentAccessForm
                                membershipId={m.membershipId}
                                personLabel={m.fullName || m.email || 'this person'}
                                roles={roleOptions}
                                groups={groupOptions}
                                manageable={manageable}
                                currentRole={m.role}
                                currentPermissions={m.permissions}
                              />
                              <RemoveAgentForm
                                membershipId={m.membershipId}
                                personLabel={m.fullName || m.email || 'This person'}
                              />
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invitations you have sent</CardTitle>
              <CardDescription>
                People stay on this list until they open the email and set a password. They arrive
                with the access shown here.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Invited as</TableHead>
                    <TableHead>Where it got to</TableHead>
                    <TableHead>Invitation expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={5} className="p-0">
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
                            variant={invite.role === ROLES.COMPANY_ADMIN ? 'default' : 'secondary'}
                          >
                            {companyLabel('role', invite.role)}
                          </Badge>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {summarisePermissions(invite.permissions)}
                          </span>
                        </TableCell>
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
              <AgentInviteForm
                roles={roleOptions}
                groups={groupOptions}
                manageable={manageable}
                defaultRole={defaultRole}
              />
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
              {/* Three buttons that all looked identical, with nothing anywhere
                  saying which one was already true. An owner pressed one, the
                  page re-rendered looking exactly the same, and the only way to
                  find out whether it had worked was to scroll up and read their
                  own row in the table. The current status is now marked on the
                  control itself, and `aria-pressed` says the same thing to a
                  screen reader. */}
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Set my status to</legend>
                <div className="flex flex-wrap gap-2">
                  {(['online', 'away', 'offline'] as const).map((status) => {
                    const current = myPresence === status;
                    return (
                      <form key={status} action={setAgentPresenceAction}>
                        <input type="hidden" name="status" value={status} />
                        <Button
                          type="submit"
                          variant={current ? 'default' : 'outline'}
                          size="sm"
                          aria-pressed={current}
                        >
                          {labelFor(PRESENCE_LABELS, status)}
                        </Button>
                      </form>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  You are currently{' '}
                  <span className="font-medium text-foreground">
                    {labelFor(PRESENCE_LABELS, myPresence)}
                  </span>
                  .
                </p>
              </fieldset>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
