import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { TabLinks } from '@/components/ui/tabs';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { t } from '@/lib/i18n';
import { getRequestDictionary } from '@/lib/i18n/server';
import {
  listAgentGroups,
  listContactGroups,
  listLeadOptions,
  listTeamMemberOptions,
} from '@/modules/company/groups-data';
import {
  deleteGroupAction,
  removeContactMemberAction,
  removeTeamMemberAction,
  renameGroupAction,
} from '@/modules/company/groups-actions';
import {
  AddContactMemberForm,
  AddTeamMemberForm,
  CreateGroupForm,
} from '@/modules/company/components/group-forms';

export const dynamic = 'force-dynamic';

async function rename(formData: FormData) {
  'use server';
  await renameGroupAction(formData);
}
async function removeGroup(formData: FormData) {
  'use server';
  await deleteGroupAction(formData);
}
async function removeTeamMember(formData: FormData) {
  'use server';
  await removeTeamMemberAction(formData);
}
async function removeContactMember(formData: FormData) {
  'use server';
  await removeContactMemberAction(formData);
}

export default async function GroupsPage({ searchParams }: { searchParams?: { tab?: string } }) {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const tab = searchParams?.tab === 'contacts' ? 'contacts' : 'team';
  const dict = await getRequestDictionary();

  // Only the active tab's data is fetched — the panels are mutually exclusive,
  // so loading both would double the queries to render one of them.
  const [teamGroups, teamOptions] =
    tab === 'team' ? await Promise.all([listAgentGroups(), listTeamMemberOptions()]) : [[], []];
  const [contactGroups, leadOptions] =
    tab === 'contacts' ? await Promise.all([listContactGroups(), listLeadOptions()]) : [[], []];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={t(dict, 'groups.title')} description={t(dict, 'groups.description')} />

      <TabLinks
        label={t(dict, 'groups.title')}
        active={tab}
        items={[
          { key: 'team', label: t(dict, 'groups.tab.team'), href: '?tab=team' },
          { key: 'contacts', label: t(dict, 'groups.tab.contacts'), href: '?tab=contacts' },
        ]}
      >
        <Card>
          <CardHeader>
            <CardTitle>
              {tab === 'team' ? t(dict, 'groups.tab.team') : t(dict, 'groups.tab.contacts')}
            </CardTitle>
            <CardDescription>
              {tab === 'team'
                ? 'Route tickets and assign conversations to a whole team at once.'
                : 'Target broadcasts and campaigns at a named set of contacts.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateGroupForm kind={tab === 'team' ? 'team' : 'contact'} />
          </CardContent>
        </Card>

        {tab === 'team' ? (
          teamGroups.length === 0 ? (
            <Card>
              <CardContent className="p-0">
                <EmptyState
                  title={t(dict, 'groups.empty.team')}
                  body="Create a group above, then add the teammates who should get its work."
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {teamGroups.map((group) => {
                const inGroup = new Set(group.members.map((m) => m.userId));
                return (
                  <Card key={group.id}>
                    <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="flex flex-wrap items-center gap-2">
                          {group.name}
                          <Badge variant="outline">
                            {group.members.length} {t(dict, 'table.members').toLowerCase()}
                          </Badge>
                        </CardTitle>
                        {group.description ? (
                          <CardDescription>{group.description}</CardDescription>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <form action={rename} className="flex items-end gap-2">
                          <input type="hidden" name="kind" value="team" />
                          <input type="hidden" name="groupId" value={group.id} />
                          <label htmlFor={`${group.id}-rename`} className="sr-only">
                            {t(dict, 'common.rename')}
                          </label>
                          <Input
                            id={`${group.id}-rename`}
                            name="name"
                            defaultValue={group.name}
                            maxLength={80}
                            className="h-9 w-40"
                          />
                          <Button type="submit" size="sm" variant="outline">
                            {t(dict, 'common.rename')}
                          </Button>
                        </form>
                        <form action={removeGroup}>
                          <input type="hidden" name="kind" value="team" />
                          <input type="hidden" name="groupId" value={group.id} />
                          <ConfirmSubmit
                            label={t(dict, 'common.delete')}
                            question="The group goes away; nobody is removed from your team."
                          />
                        </form>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {group.members.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nobody in this group yet.</p>
                      ) : (
                        <ul className="divide-y">
                          {group.members.map((member) => (
                            <li
                              key={member.userId}
                              className="flex items-center justify-between gap-3 py-2"
                            >
                              <span className="truncate text-sm">
                                {member.email ?? member.userId}
                              </span>
                              <form action={removeTeamMember}>
                                <input type="hidden" name="groupId" value={group.id} />
                                <input type="hidden" name="userId" value={member.userId} />
                                {/* Was a bare "Remove" that fired on the first
                                    click, and every row's button read the same.
                                    The person is named in the label — composed
                                    from the existing dictionary verb rather than
                                    a new key — and ConfirmSubmit arms it first. */}
                                <ConfirmSubmit
                                  label={`${t(dict, 'common.remove')} ${member.email ?? member.userId}`}
                                  confirmLabel={t(dict, 'common.remove')}
                                  question="They stop getting work routed to this group. They stay on your team and keep their account."
                                />
                              </form>
                            </li>
                          ))}
                        </ul>
                      )}
                      <AddTeamMemberForm
                        groupId={group.id}
                        options={teamOptions.filter((o) => !inGroup.has(o.userId))}
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )
        ) : contactGroups.length === 0 ? (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                title={t(dict, 'groups.empty.contacts')}
                body="Create a group above, then add the contacts a broadcast should reach."
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {contactGroups.map((group) => {
              const inGroup = new Set(group.members.map((m) => m.id));
              return (
                <Card key={group.id}>
                  <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        {group.colour ? (
                          <span
                            aria-hidden="true"
                            className="inline-block h-3 w-3 rounded-full border"
                            style={{ backgroundColor: group.colour }}
                          />
                        ) : null}
                        {group.name}
                        <Badge variant="outline">
                          {group.members.length} {t(dict, 'table.members').toLowerCase()}
                        </Badge>
                      </CardTitle>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <form action={rename} className="flex items-end gap-2">
                        <input type="hidden" name="kind" value="contact" />
                        <input type="hidden" name="groupId" value={group.id} />
                        <label htmlFor={`${group.id}-rename`} className="sr-only">
                          {t(dict, 'common.rename')}
                        </label>
                        <Input
                          id={`${group.id}-rename`}
                          name="name"
                          defaultValue={group.name}
                          maxLength={80}
                          className="h-9 w-40"
                        />
                        <Button type="submit" size="sm" variant="outline">
                          {t(dict, 'common.rename')}
                        </Button>
                      </form>
                      <form action={removeGroup}>
                        <input type="hidden" name="kind" value="contact" />
                        <input type="hidden" name="groupId" value={group.id} />
                        <ConfirmSubmit
                          label={t(dict, 'common.delete')}
                          question="The group goes away; no contact is deleted."
                        />
                      </form>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {group.members.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No contacts in this group yet.
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {group.members.map((member) => (
                          <li
                            key={`${member.type}:${member.id}`}
                            className="flex items-center justify-between gap-3 py-2"
                          >
                            <span className="truncate text-sm">{member.label}</span>
                            <form action={removeContactMember}>
                              <input type="hidden" name="groupId" value={group.id} />
                              <input type="hidden" name="contactType" value={member.type} />
                              <input type="hidden" name="contactId" value={member.id} />
                              <ConfirmSubmit
                                label={`${t(dict, 'common.remove')} ${member.label}`}
                                confirmLabel={t(dict, 'common.remove')}
                                question="They stop being included when you message this group. The contact and their history are not deleted."
                              />
                            </form>
                          </li>
                        ))}
                      </ul>
                    )}
                    <AddContactMemberForm
                      groupId={group.id}
                      options={leadOptions.filter((o) => !inGroup.has(o.id))}
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </TabLinks>
    </div>
  );
}
