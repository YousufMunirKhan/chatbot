import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth';
import {
  ROLES,
  DEFAULT_CHAT_RETENTION_DAYS,
  PRIVACY_REQUEST_LABELS,
  labelFor,
} from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from '@/modules/company/data';
import { RetentionForm } from '@/modules/company/components/retention-form';
import { DataRequestForm } from '@/modules/company/components/data-request-form';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';
import { t, tOr } from '@/lib/i18n';
import { getRequestDictionary } from '@/lib/i18n/server';
import { listDataRequests } from '@/modules/company/gdpr-data';
import { processDataRequestAction } from '@/modules/company/gdpr-actions';
import { ConfirmSubmit } from '@/components/confirm-submit';

/**
 * The settings directory.
 *
 * This grid used to be fourteen equal tiles mixing "Billing" with "Broadcasts"
 * and "Catalog" — three things an owner uses weekly, filed under a heading they
 * would only open once a year. Those three now have their own sidebar rows under
 * the job they belong to, and what is left here is what this page is actually
 * for: the yearly decisions, the plumbing, and the developer surface.
 *
 * Sub-headings, not one flat grid: a directory of sixteen links with no
 * structure is the same problem as a sidebar of thirty.
 *
 * The label and hint come from the dictionary when it has them and fall back to
 * the English written here when it does not (`tOr`), so a section added today is
 * readable immediately and translatable later without this file changing.
 */
interface SettingsLink {
  href: string;
  /** Dictionary suffix — `settings.section.<key>.label` / `.hint`. */
  key: string;
  label: string;
  hint: string;
}

const SETTINGS_GROUPS: { key: string; title: string; links: SettingsLink[] }[] = [
  {
    key: 'people',
    title: 'People',
    links: [
      {
        href: '/company/agents',
        key: 'agents',
        label: 'Team',
        hint: 'Invite staff and see who is available to take chats.',
      },
      {
        href: '/company/groups',
        key: 'groups',
        label: 'Groups',
        hint: 'Name a set of staff, or a set of customers, so you can target it.',
      },
    ],
  },
  {
    key: 'money',
    title: 'Plan and spending',
    links: [
      {
        href: '/company/billing',
        key: 'billing',
        label: 'Billing',
        hint: 'Your plan, your monthly message allowance, and your card.',
      },
      {
        href: '/company/usage',
        key: 'usage',
        label: 'Usage & limits',
        hint: 'How much of this month’s allowance you have used.',
      },
      {
        href: '/company/ai-controls',
        key: 'ai-controls',
        label: 'Spending cap',
        hint: 'Stop the assistant automatically if it costs more than you want.',
      },
    ],
  },
  {
    key: 'connected',
    title: 'Connected apps',
    links: [
      {
        href: '/company/integrations',
        key: 'integrations',
        label: 'Connect your shop',
        hint: 'Shopify, WooCommerce, Google Calendar, or a spreadsheet.',
      },
      {
        href: '/company/managed-connectors',
        key: 'managed-connectors',
        label: 'Set up for you',
        hint: 'Shopify, Square and Foodics — paste a token, we do the rest.',
      },
      {
        href: '/company/webhooks',
        key: 'webhooks',
        label: 'Send data elsewhere',
        hint: 'Push new leads and orders into Slack, a CRM, or your own system.',
      },
      {
        href: '/company/developers',
        key: 'developers',
        label: 'For developers',
        hint: 'API keys and code, if someone is building on top of this.',
      },
    ],
  },
  {
    key: 'service',
    title: 'Service and safety',
    links: [
      {
        href: '/company/sla',
        key: 'sla',
        label: 'Reply-time targets',
        hint: 'How fast your team promises to answer, and a warning before you miss it.',
      },
      {
        href: '/company/support-settings',
        key: 'support-settings',
        label: 'Inbox rules',
        hint: 'Opening hours and who a new chat goes to.',
      },
      {
        href: '/company/security',
        key: 'security',
        label: 'Sign-in & security',
        hint: 'Two-step sign-in, and recent activity on your account.',
      },
    ],
  },
];

async function getRetentionDays(): Promise<number> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_settings')
    .select('value_json')
    .eq('company_id', companyId)
    .eq('key', 'chat_retention_days')
    .maybeSingle();
  if (!data) return DEFAULT_CHAT_RETENTION_DAYS;
  const raw = (data as Record<string, unknown>).value_json;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CHAT_RETENTION_DAYS;
}

async function processRequest(formData: FormData) {
  'use server';
  await processDataRequestAction(formData);
}

export default async function CompanySettingsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [retentionDays, dataRequests, dict] = await Promise.all([
    getRetentionDays(),
    listDataRequests(),
    getRequestDictionary(),
  ]);
  const openRequests = dataRequests.filter((r) => r.status === 'open' || r.status === 'processing');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={tOr(dict, 'settings.title', 'Settings')}
        description={tOr(
          dict,
          'settings.description',
          'Your team, your bill, the apps you have connected, and how your data is kept.',
        )}
      />

      {/*
        TWO KINDS OF THING ON ONE PAGE, NOW SAID OUT LOUD
        -------------------------------------------------
        Everything above the rule is a DIRECTORY — twelve links to elsewhere.
        Everything below it is work you do HERE: how long chats are kept, the
        privacy requests waiting on you, and your export. They were stacked in
        one undifferentiated column of `space-y-6`, so the four cards at the
        bottom read as four more directory entries that happened to be bigger,
        and the pending-requests card — the only thing on this page with a
        deadline attached to it — was the tenth block down with no signal that
        anybody was waiting.
      */}
      {SETTINGS_GROUPS.map((group) => (
        <section key={group.key} className="space-y-3">
          <h2 className="text-sm font-semibold">
            {tOr(dict, `settings.group.${group.key}`, group.title)}
          </h2>
          {/* `lg:grid-cols-3` measured the viewport; these tiles carry a label
              and a full sentence, so they need a floor, not a count. */}
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
            {group.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <p className="text-sm font-medium">
                  {tOr(dict, `settings.section.${link.key}.label`, link.label)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tOr(dict, `settings.section.${link.key}.hint`, link.hint)}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <div className="space-y-3 border-t pt-6">
        <h2 className="text-sm font-semibold">
          {tOr(dict, 'settings.group.privacy', 'Your data and your customers’ data')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {tOr(
            dict,
            'settings.group.privacy_hint',
            'These are done here rather than somewhere else, because they act on everything at once.',
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t(dict, 'settings.retention.title')}</CardTitle>
          <CardDescription>{t(dict, 'settings.retention.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <RetentionForm current={retentionDays} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t(dict, 'settings.requests.title')}</CardTitle>
          <CardDescription>{t(dict, 'settings.requests.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataRequestForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          {/* The count was invisible until you read the list. A customer's
              privacy request has a statutory clock on it, so "3" belongs in the
              title, and the badge tone says whether anything is waiting. */}
          <CardTitle className="flex flex-wrap items-center gap-2">
            {t(dict, 'settings.pending.title')}
            {openRequests.length > 0 ? (
              <Badge variant="warning">{openRequests.length}</Badge>
            ) : null}
          </CardTitle>
          <CardDescription>{t(dict, 'settings.pending.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {openRequests.length === 0 ? (
            <EmptyState
              title={t(dict, 'settings.pending.empty')}
              body={tOr(
                dict,
                'settings.pending.empty_body',
                'When a customer asks for a copy of their data or asks you to delete it, the request waits here until you act on it.',
              )}
            />
          ) : (
            <ul className="divide-y">
              {openRequests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {/* The badge printed the stored value ("export"), which is
                          the developer's word for it. The map says what the
                          customer actually asked for. */}
                      <Badge variant={r.requestType === 'delete' ? 'destructive' : 'secondary'}>
                        {labelFor(PRIVACY_REQUEST_LABELS, r.requestType)}
                      </Badge>
                      <span className="truncate font-medium">{r.requesterEmail}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t(dict, 'settings.pending.requested', { date: formatDate(r.createdAt) })}
                    </p>
                  </div>
                  {/* `flex-wrap`: the erase path arms into a sentence, a
                      type-to-confirm box and two buttons, which at any width
                      below a laptop ran straight off the card. */}
                  <div className="flex flex-wrap items-start gap-2">
                    <form action={processRequest}>
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="decision" value="execute" />
                      {r.requestType === 'delete' ? (
                        <ConfirmSubmit
                          label={t(dict, 'settings.pending.erase')}
                          confirmLabel={t(dict, 'settings.pending.erase_confirm')}
                          pendingLabel={t(dict, 'settings.pending.erase_pending')}
                          question={t(dict, 'settings.pending.erase_question')}
                          typeToConfirm="ERASE"
                          idleVariant="destructive"
                        />
                      ) : (
                        <Button type="submit" size="sm">
                          {t(dict, 'settings.pending.done')}
                        </Button>
                      )}
                    </form>
                    <form action={processRequest}>
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <Button type="submit" size="sm" variant="ghost">
                        {t(dict, 'settings.pending.reject')}
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t(dict, 'settings.export.title')}</CardTitle>
          <CardDescription>{t(dict, 'settings.export.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/api/company/export">{t(dict, 'settings.export.cta')}</a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t(dict, 'settings.security.title')}</CardTitle>
          <CardDescription>{t(dict, 'settings.security.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Five statements about how the product protects this company's
              data, drawn in amber because `InfoBanner` is hardwired to
              `tone="warning"`. Amber is the product's "something is wrong"
              colour; putting it round a list of guarantees says the opposite of
              what the words say. `success` is what this card is: things that
              are already true and in your favour. */}
          <Alert tone="success">
            <ul className="list-disc space-y-1 ps-5">
              <li>{t(dict, 'settings.security.point.encryption')}</li>
              <li>{t(dict, 'settings.security.point.isolation')}</li>
              <li>{t(dict, 'settings.security.point.ratelimit')}</li>
              <li>{t(dict, 'settings.security.point.orders')}</li>
              <li>{t(dict, 'settings.security.point.cards')}</li>
            </ul>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
