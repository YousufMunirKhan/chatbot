import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import {
  ROLES,
  WHATSAPP_NAME_STATUS_LABELS,
  WHATSAPP_QUALITY_LABELS,
  WHATSAPP_TIER_LABELS,
  labelFor,
} from '@/lib/constants';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { UpgradeNotice } from '@/components/ui/upgrade-notice';
import { companyHasFeature, requireCompanyFeature } from '@/lib/entitlements';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/format';
import { WHATSAPP_GUIDES } from '@/lib/channels/whatsapp-guides';
import {
  getCatalogSettings,
  getGuideProgress,
  getWhatsAppAccountStatus,
  listCatalogProducts,
  listWhatsAppIdentities,
} from '@/modules/company/whatsapp-data';
import {
  setProductRetailerIdAction,
  toggleGuideStepAction,
} from '@/modules/company/whatsapp-actions';
import {
  CatalogSettingsForm,
  WabaIdForm,
} from '@/modules/company/components/whatsapp-settings-forms';

// The gate below decides what this page draws; these decide what a post can do.
// A form that is never rendered is still reachable with a crafted request.
async function saveRetailerId(formData: FormData) {
  'use server';
  await requireCompanyFeature('whatsapp');
  await setProductRetailerIdAction(formData);
}
async function toggleStep(formData: FormData) {
  'use server';
  await requireCompanyFeature('whatsapp');
  await toggleGuideStepAction(formData);
}

function qualityVariant(rating: string): 'success' | 'warning' | 'destructive' | 'outline' {
  if (rating === 'GREEN') return 'success';
  if (rating === 'YELLOW') return 'warning';
  if (rating === 'RED') return 'destructive';
  return 'outline';
}

export default async function WhatsAppPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  // Checked before the Meta round trip below: a company that cannot use the
  // channel should not be spending our token budget reading its health.
  if (!(await companyHasFeature('whatsapp'))) return <UpgradeNotice feature="whatsapp" />;

  const [identities, status, catalog, products, progress] = await Promise.all([
    listWhatsAppIdentities(),
    getWhatsAppAccountStatus(),
    getCatalogSettings(),
    listCatalogProducts(),
    getGuideProgress(),
  ]);
  const primary = identities.find((i) => i.isActive) ?? identities[0] ?? null;
  const mapped = products.filter((p) => p.retailerId).length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="WhatsApp"
        description="How healthy your WhatsApp number is with Meta, and everything you can send from it."
        actions={
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/company/whatsapp/templates">Templates</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/company/whatsapp/subscribers">Subscribers</Link>
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>How your number is doing</CardTitle>
          <CardDescription>
            Read live from Meta. If customers block or report you, WhatsApp lowers your rating and
            delivers fewer of your messages — so this is worth a glance before you send anything to
            a lot of people.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!primary ? (
            <EmptyState
              title="No WhatsApp number connected"
              body="Connect your WhatsApp Business number on the Channels page, then come back here for templates, consent, and catalog selling."
              action={
                <Button asChild size="sm">
                  <Link href="/company/channels">Connect WhatsApp</Link>
                </Button>
              }
            />
          ) : (
            <>
              {/* Four facts, each a label plus a value plus (twice) a sentence.
                  `lg:grid-cols-4` gave each one about 215px at 1024px, where
                  "You can message first" wrapped to three lines above a value
                  that wrapped to two. `auto-fit` at a 13rem floor drops to two
                  columns before that happens, and to one on a phone. */}
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Number</p>
                  <p className="mt-1 font-medium">
                    {status?.displayPhoneNumber ?? primary.externalId}
                  </p>
                  {status?.verifiedName ? (
                    <p className="text-xs text-muted-foreground">{status.verifiedName}</p>
                  ) : null}
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Standing with WhatsApp</p>
                  <p className="mt-1">
                    {/* Meta returns GREEN / YELLOW / RED. Colour alone is not a
                        signal (a red-green viewer sees two identical chips), so
                        the words carry the meaning and the badge tone only
                        reinforces it. */}
                    <Badge variant={qualityVariant(status?.qualityRating ?? 'UNKNOWN')}>
                      {labelFor(WHATSAPP_QUALITY_LABELS, status?.qualityRating, 'Not reported yet')}
                    </Badge>
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">You can message first</p>
                  <p className="mt-1 font-medium">
                    {labelFor(WHATSAPP_TIER_LABELS, status?.messagingLimit, 'Not reported yet')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Replies to a customer who wrote to you first never count towards this.
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Your business name</p>
                  <p className="mt-1 font-medium">
                    {labelFor(WHATSAPP_NAME_STATUS_LABELS, status?.nameStatus, 'Not submitted')}
                  </p>
                </div>
              </div>

              {/* This is a failure — the four figures above it may be stale —
                  and it was drawn as a dashed grey box in muted text, which is
                  the product's convention for "nothing here yet". `Alert
                  tone="warning"` is the convention for "something is wrong",
                  and it is what every other page uses for this. */}
              {status?.error ? (
                <Alert tone="warning" title="Live status could not be read from Meta">
                  <p>
                    The figures above may be out of date. This usually means the access token saved
                    on the Messaging apps page has expired, or is missing the permission called{' '}
                    <code className="rounded bg-background/60 px-1">
                      whatsapp_business_management
                    </code>
                    .
                  </p>
                  {/* Meta's own error text is kept, but demoted: useful to whoever
                      set the number up, meaningless to everyone else. */}
                  <p className="mt-1 text-xs opacity-80">Meta said: {status.error}</p>
                </Alert>
              ) : null}

              <div className="max-w-md border-t pt-4">
                <WabaIdForm identityId={primary.id} wabaId={primary.wabaId} />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card id="catalog">
        <CardHeader>
          <CardTitle>Sell from a product list</CardTitle>
          <CardDescription>
            Link the product catalogue you keep in Facebook Business so the assistant can send
            tappable product cards instead of typing out a price list. {mapped} of {products.length}{' '}
            products are linked so far.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="max-w-md">
            <CatalogSettingsForm catalogId={catalog.catalogId} isActive={catalog.isActive} />
          </div>

          <div>
            {/* Was a bold `<p>` doing a heading's job, so this section did not
                exist in the document outline at all — a screen-reader user
                jumping by heading went straight from "Sell from a product list"
                to the next card. */}
            <h3 className="text-base font-semibold">Match up your products</h3>
            <p className="mb-3 mt-1 text-sm text-muted-foreground">
              Each product needs the same id here as it has in your Facebook catalogue, so WhatsApp
              knows which card to show. If you are not sure, your SKU is usually the right answer.
            </p>
            {products.length === 0 ? (
              <EmptyState
                title="No products synced yet"
                body="Products come from your integrations. Import a store or a CSV, then map each product to the retailer id used in your Meta catalog feed."
                action={
                  <Button asChild size="sm">
                    <Link href="/company/integrations">Import products</Link>
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Id in your Facebook catalogue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.title}</TableCell>
                      <TableCell>
                        {p.price == null ? '—' : formatCurrency(p.price, p.currency)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.sku ?? '—'}</TableCell>
                      <TableCell>
                        <form action={saveRetailerId} className="flex gap-2">
                          <input type="hidden" name="productId" value={p.id} />
                          {/* The placeholder suggests this product's SKU because
                              that is usually the right answer; with no SKU it
                              says what to type rather than naming the field
                              again in machine words. */}
                          {/* `h-8` was a fourth control height invented here —
                              32px, against the 36px `Button size="sm"` sitting
                              directly beside it, so the input and its own Save
                              button were visibly out of line on every row. The
                              scale has exactly two heights and both controls
                              have both; `size="sm"` is the one that matches a
                              small button. */}
                          <Input
                            size="sm"
                            name="retailerId"
                            defaultValue={p.retailerId ?? ''}
                            maxLength={100}
                            placeholder={p.sku ?? 'Same id as in Facebook'}
                            className="max-w-[200px]"
                            aria-label={`Id in your Facebook catalogue for ${p.title}`}
                          />
                          {/* One Save button per row, so it names the row. */}
                          <Button type="submit" size="sm" variant="outline">
                            <span className="sr-only">Save the catalogue id for {p.title}</span>
                            <span aria-hidden>Save</span>
                          </Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

      {WHATSAPP_GUIDES.map((guide) => {
        const done = progress[guide.key] ?? {};
        const completed = guide.steps.filter((s) => done[s.key]).length;
        return (
          <Card key={guide.key} id={guide.key}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {guide.title}
                <Badge variant={completed === guide.steps.length ? 'success' : 'secondary'}>
                  {completed}/{guide.steps.length} done
                </Badge>
              </CardTitle>
              <CardDescription>
                {guide.summary} <span className="whitespace-nowrap">({guide.duration}.)</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {guide.steps.map((step, index) => {
                  const isDone = done[step.key] === true;
                  return (
                    <li
                      key={step.key}
                      className="flex flex-wrap items-start justify-between gap-3 p-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          className={`font-medium ${isDone ? 'text-muted-foreground line-through' : ''}`}
                        >
                          {index + 1}. {step.title}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
                        {step.where ? (
                          <p className="mt-1 text-xs text-muted-foreground">Where: {step.where}</p>
                        ) : null}
                      </div>
                      <form action={toggleStep}>
                        <input type="hidden" name="guide" value={guide.key} />
                        <input type="hidden" name="stepKey" value={step.key} />
                        <input type="hidden" name="done" value={(!isDone).toString()} />
                        {/* Twelve identical "Mark done" buttons down the page,
                            each announced to a screen reader as just "Mark
                            done". The step name makes each one distinct without
                            adding anything a sighted reader has to look at. */}
                        <Button type="submit" size="sm" variant={isDone ? 'ghost' : 'outline'}>
                          {isDone ? 'Undo' : 'Mark done'}
                          <span className="sr-only">: {step.title}</span>
                        </Button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
