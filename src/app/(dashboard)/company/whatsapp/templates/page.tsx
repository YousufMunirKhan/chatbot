import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES, WHATSAPP_TEMPLATE_STATUS_LABELS, humanizeToken, labelFor } from '@/lib/constants';
import { companyLabel } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { formatDate } from '@/lib/format';
import {
  listWhatsAppTemplates,
  getPrimaryWhatsAppCredentials,
} from '@/modules/company/whatsapp-data';
import {
  deleteWhatsAppTemplateAction,
  submitWhatsAppTemplateAction,
  syncWhatsAppTemplatesAction,
} from '@/modules/company/whatsapp-actions';
import { WhatsAppTemplateForm } from '@/modules/company/components/whatsapp-template-form';

async function sync() {
  'use server';
  await syncWhatsAppTemplatesAction();
}
async function submit(formData: FormData) {
  'use server';
  await submitWhatsAppTemplateAction(formData);
}
async function remove(formData: FormData) {
  'use server';
  await deleteWhatsAppTemplateAction(formData);
}

function statusVariant(status: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (status === 'approved') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'rejected') return 'destructive';
  return 'secondary';
}

/**
 * Meta files a template under a locale (`en_US`, `ar_EG`), not a bare language,
 * and the badge printed that code verbatim. `companyLabel('language', …)` only
 * knows `en`/`ar`, so take the language part first — and keep Meta's own code if
 * we have nothing to show for it, because a raw `pt_BR` still tells the owner
 * which template this is and a blank badge tells them nothing.
 */
function templateLanguageLabel(locale: string): string {
  const base = locale.split(/[_-]/)[0] ?? '';
  return companyLabel('language', base.toLowerCase()) || locale;
}

export default async function WhatsAppTemplatesPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [templates, creds] = await Promise.all([
    listWhatsAppTemplates(),
    getPrimaryWhatsAppCredentials(),
  ]);
  const canSubmitToMeta = Boolean(creds?.token && creds?.wabaId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        backTo={{ href: '/company/whatsapp', label: 'WhatsApp Business' }}
        title="Approved messages"
        description="WhatsApp will not let you message somebody out of the blue, or more than 24 hours after they last replied. The way round it is to get your wording approved by WhatsApp first — that is what this page is for."
        actions={
          <form action={sync}>
            <Button type="submit" size="sm" variant="outline" disabled={!canSubmitToMeta}>
              Sync from Meta
            </Button>
          </form>
        }
      />

      {!canSubmitToMeta ? (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Templates can be drafted now, but submitting or syncing needs a connected number with an
            access token and a{' '}
            <Link href="/company/whatsapp" className="text-primary hover:underline">
              WABA id
            </Link>
            .
          </CardContent>
        </Card>
      ) : null}

      <Card id="new-template">
        <CardHeader>
          <CardTitle>New template</CardTitle>
          <CardDescription>
            Meta reviews every template, usually within a few minutes. Marketing templates are held
            to the strictest standard — say who you are and why you are messaging.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WhatsAppTemplateForm canSubmitToMeta={canSubmitToMeta} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {templates.length === 0 ? (
            <EmptyState
              title="No templates yet"
              body="Create one template for each conversation you want to start — an order update, an appointment reminder, a seasonal offer. Approved ones can be used in broadcasts."
              action={
                <Button asChild size="sm">
                  <a href="#new-template">Write a template</a>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y">
              {templates.map((t) => (
                <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Meta's verdict decides whether this template can be
                          sent at all, so the badge says what the owner can do
                          about it rather than echoing WhatsApp's enum. */}
                      <Badge variant={statusVariant(t.status)}>
                        {labelFor(
                          WHATSAPP_TEMPLATE_STATUS_LABELS,
                          t.status,
                          'Not sent for review yet',
                        )}
                      </Badge>
                      <Badge variant="outline">{templateLanguageLabel(t.language)}</Badge>
                      {/* `MARKETING` / `UTILITY` / `AUTHENTICATION` are Meta's
                          own category tokens; new ones appear without warning,
                          so this degrades through `humanizeToken`. */}
                      <Badge variant="outline">{humanizeToken(t.category)}</Badge>
                    </div>
                    <p className="mt-1 font-medium">{t.name}</p>
                    {t.headerText ? <p className="text-sm font-medium">{t.headerText}</p> : null}
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
                      {t.body}
                    </p>
                    {t.footerText ? (
                      <p className="text-xs text-muted-foreground">{t.footerText}</p>
                    ) : null}
                    {t.buttons.length ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Buttons: {t.buttons.map((b) => b.text).join(' · ')}
                      </p>
                    ) : null}
                    {t.rejectionReason ? (
                      <p className="mt-1 text-xs text-danger-fg">Meta said: {t.rejectionReason}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Created {formatDate(t.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {t.status === 'draft' || t.status === 'rejected' ? (
                      <form action={submit}>
                        <input type="hidden" name="id" value={t.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          disabled={!canSubmitToMeta}
                        >
                          Submit to Meta
                        </Button>
                      </form>
                    ) : null}
                    <form action={remove}>
                      <input type="hidden" name="id" value={t.id} />
                      <ConfirmSubmit
                        label="Delete"
                        question="The template is removed from Meta too and can no longer be sent."
                      />
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
