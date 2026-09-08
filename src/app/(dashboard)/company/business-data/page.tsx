import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { companyLabel } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import {
  getBusinessMemory,
  type BusinessReadinessItem,
} from '@/modules/company/business-profile-data';
import { getCurrentCompany, listBots } from '@/modules/company/data';
import { documentEditRefusal, listDocuments } from '@/modules/company/knowledge-data';
import {
  deleteFaqAction,
  deleteLocationAction,
  deletePolicyAction,
  deleteServiceAction,
} from '@/modules/company/business-profile-actions';
import { deleteDocumentAction } from '@/modules/company/knowledge-actions';
import { ProfileForm } from '@/modules/company/components/profile-form';
import {
  BusinessMemoryForm,
  EditFaqForm,
  EditPolicyForm,
  EditServiceForm,
  FaqForm,
  HoursForm,
  LocationForm,
  PolicyForm,
  ServiceForm,
} from '@/modules/company/components/business-memory-forms';
import { KnowledgeForm } from '@/modules/company/components/knowledge-form';
import {
  BusinessDataTabs,
  type BusinessDataTab,
} from '@/modules/company/components/business-data-tabs';
import { categoryLabel } from '@/modules/company/business-categories';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { CHOICE_GRID } from '@/modules/company/components/form-layout';

function DeleteButton({
  id,
  fieldName = 'id',
  action,
  question,
  label = 'Delete',
}: {
  id: string;
  fieldName?: string;
  action: (formData: FormData) => Promise<void>;
  question?: string;
  /** Say what is going, not just that something is. */
  label?: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name={fieldName} value={id} />
      {/* Every call site now passes its own `question`; the fallback still
          names a consequence rather than leaving the owner to guess what
          disappears. A bare "Delete" told them nothing before arming it. */}
      <ConfirmSubmit
        label={label}
        confirmLabel="Yes, delete it"
        question={
          question ??
          'Your assistant stops using this straight away and stops answering the questions that relied on it. This cannot be undone.'
        }
      />
    </form>
  );
}

const READINESS_HELP: Record<string, string> = {
  description: 'Used when customers ask what your business does.',
  industry: 'Helps the assistant choose the right language and examples.',
  contact: 'Used when customers need to call, email, or WhatsApp you.',
  location: 'Used for branch, delivery, service-area, and direction questions.',
  hours: 'Used when customers ask if you are open or want a booking time.',
  services: 'Used for pricing, offers, demos, appointments, and sales questions.',
  policies: 'Used for delivery, refunds, privacy, support, and terms questions.',
  faqs: 'Used for common questions where you want exact approved answers.',
  handoff: 'Tells the assistant when to stop and pass the chat to a person.',
  qualification: 'Tells the assistant what to ask before creating a lead or appointment.',
};

function ReadinessGrid({ items }: { items: BusinessReadinessItem[] }) {
  return (
    // `CHOICE_GRID` rather than `sm:grid-cols-2 lg:grid-cols-3`: each tile
    // carries a label, a sentence and a badge on the same row, and at
    // `lg:grid-cols-3` inside a card on a `max-w-7xl` page that is ~360px —
    // fine — but this component is also the natural thing to drop into a
    // sidebar later, where the same class would give it 130px. `auto-fit`
    // holds either way.
    <div className={CHOICE_GRID}>
      {items.map((item) => (
        <div key={item.key} className="rounded-md border p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">{item.label}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {READINESS_HELP[item.key] ?? 'Used by the assistant for more accurate answers.'}
              </p>
            </div>
            <Badge variant={item.complete ? 'success' : 'secondary'}>
              {item.complete ? 'Ready' : 'Needs info'}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A card heading with a sentence under it.
 *
 * This was `<h2 className="text-lg font-semibold">` plus a `<p>` — which is
 * `CardTitle` + `CardDescription` written out by hand, at a DIFFERENT size.
 * The two are used side by side inside the same split on four of this page's
 * tabs: "Existing services and offers" is a `CardTitle`, "Add a service or
 * offer" was this, and the second one was visibly two steps larger than the
 * first. Same kind of thing, same place on the screen, two type sizes.
 *
 * It stays as a named component because the call sites read better for it; it
 * just renders the primitives now, so it can never drift again.
 *
 * Named `CardHeading` and not `SectionHeader`: there is a real `SectionHeader`
 * in `src/components/ui/`, it does something different (a heading INSIDE a
 * card, with its own size and level props), and a local component shadowing
 * that name is how the next person imports the wrong one.
 */
function CardHeading({ title, description }: { title: string; description: string }) {
  return (
    <>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </>
  );
}

/**
 * The row-level edit disclosure used by the services, policies and FAQ tables.
 *
 * Three copies of a bare `<details><summary className="cursor-pointer …">`,
 * and all three had the same two faults.
 *
 * **Every summary on the page said the same words.** "Edit service", twelve
 * times, one per row. A screen-reader user pulling up the list of controls got
 * twelve identical entries and no way to tell which row each belonged to. The
 * row's own name goes in the accessible name; the visible words stay short.
 *
 * **The focus ring was whatever the browser felt like.** `<summary>` is
 * focusable and the Tailwind preflight resets its outline, so tabbing through
 * a table of services moved focus through controls that gave no sign of having
 * it. The ring here is the same `focus-visible:ring-2 ring-ring` every other
 * control in the product uses.
 */
function EditDisclosure({
  label,
  name,
  children,
}: {
  /** The verb, shown. Kept to two words. */
  label: string;
  /** Which row this is. Announced, not shown — it is already the row's cell. */
  name: string;
  children: ReactNode;
}) {
  return (
    <details>
      {/* No custom chevron. `<summary>` already draws the platform's own
          disclosure marker — Tailwind's preflight does not remove it — so a
          glyph added here is a second arrow beside the first. It would also
          have been the wrong arrow in Arabic: mirroring is `.dir-arrow`, which
          works by setting `transform: scaleX(-1)`, and any Tailwind rotate
          utility sets `transform` too and wins, so the two cancel. The marker
          the browser supplies is already mirrored by the shell's `dir`. */}
      <summary className="w-fit cursor-pointer rounded-md text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        {label}
        <span className="sr-only">: {name}</span>
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}

/**
 * The shape all four "add one, then look at the ones you have" tabs take.
 *
 * ## Why the layout changes when the list is empty
 *
 * Every one of these tabs was an unconditional
 * `lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]` split: the form in the narrow
 * side, the list in the wide side. That is the right shape once there is a
 * list — you add a service while reading the ones you already have, which is
 * why the form is sticky.
 *
 * With nothing saved yet it is the wrong shape twice over. The wide 1.5fr
 * column — two thirds of the page — held an `EmptyState` whose entire content
 * was a sentence and a button reading "Add a service", and that button scrolled
 * you to a form ALREADY VISIBLE beside it. Meanwhile the thing you actually
 * came to do was crushed into the 400px third, where `ServiceForm`'s ten
 * fields stack into one long column. Two thirds of the screen were spent
 * telling you to look at the other third.
 *
 * So: no list, no split. The form takes the width, and the sentence the empty
 * state was carrying moves into the card description where it introduces the
 * form instead of pointing at it. This is the same reasoning `/company/flows`
 * was rebuilt on — with no flows, the templates ARE the task and they get the
 * page.
 */
function ListAndAdd({
  isEmpty,
  addId,
  addTitle,
  /** Introduces the form when there is already a list beside it. */
  addDescription,
  /** Introduces the form when it is the only thing on the tab. Says why it is worth doing. */
  firstRunDescription,
  form,
  listTitle,
  list,
}: {
  isEmpty: boolean;
  addId: string;
  addTitle: string;
  addDescription: string;
  firstRunDescription: string;
  form: ReactNode;
  listTitle: string;
  list: ReactNode;
}) {
  if (isEmpty) {
    return (
      <Card id={addId}>
        <CardHeader>
          <CardHeading title={addTitle} description={firstRunDescription} />
        </CardHeader>
        <CardContent>{form}</CardContent>
      </Card>
    );
  }

  return (
    // Grid tracks are positional, so column 1 (the list, ordered first in the
    // DOM and therefore first for a screen reader and on a phone) is the wide
    // one. `[&>*]:min-w-0` because a grid item's default `min-width: auto` is
    // "as wide as my longest unbreakable child" — one long service name would
    // otherwise widen the track, then the page.
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
      <Card className="lg:order-1">
        <CardHeader>
          <CardTitle>{listTitle}</CardTitle>
        </CardHeader>
        <CardContent>{list}</CardContent>
      </Card>

      {/* Sticky on desktop: you add one while reading the list, so it must not
          scroll away as that list grows. */}
      <Card id={addId} className="lg:sticky lg:top-6 lg:order-2 lg:self-start">
        <CardHeader>
          <CardHeading title={addTitle} description={addDescription} />
        </CardHeader>
        <CardContent>{form}</CardContent>
      </Card>
    </div>
  );
}

function servicePrice(service: {
  priceFrom: number | null;
  priceTo: number | null;
  currency: string;
}) {
  if (service.priceFrom == null && service.priceTo == null) return '-';
  if (
    service.priceFrom != null &&
    service.priceTo != null &&
    service.priceFrom !== service.priceTo
  ) {
    return `${formatCurrency(service.priceFrom, service.currency)} - ${formatCurrency(service.priceTo, service.currency)}`;
  }
  return formatCurrency(service.priceFrom ?? service.priceTo ?? 0, service.currency);
}

export default async function BusinessDataWorkspacePage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [company, memory, docs, bots] = await Promise.all([
    getCurrentCompany(),
    getBusinessMemory(),
    listDocuments(),
    listBots(),
  ]);
  const botOptions = bots.map((bot) => ({ id: bot.id, name: bot.name }));
  const uploadedFileCount = docs.filter((doc) =>
    ['pdf', 'docx', 'txt'].includes(doc.sourceType),
  ).length;

  const tabs: BusinessDataTab[] = [
    {
      key: 'overview',
      label: 'Overview',
      helper:
        'This explains what the assistant already understands and what still needs information.',
      badge: `${memory.readiness.percent}%`,
      content: (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>What “ready” means</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Ready means the assistant has enough saved business facts to answer that topic.
                Needs info means customers may get weak or incomplete answers for that topic until
                you add data.
              </p>
              <ReadinessGrid items={memory.readiness.items} />
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      key: 'basics',
      label: 'Basics & hours',
      helper:
        'Your name and address, when you are open, and when the assistant should fetch a person instead of answering.',
      content: (
        // Four independent forms, so two-up on a wide screen rather than one
        // 1150px column of short fields. `min-w-0` so a long saved value
        // cannot stretch its track and push the page sideways.
        <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <CardHeader>
              <CardHeading
                title="Your company"
                description="The name, website, language, country and time zone on your account. The assistant uses the language and time zone to decide how to answer and what counts as today."
              />
            </CardHeader>
            <CardContent>
              <ProfileForm company={company} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardHeading
                title="What your assistant should know"
                description="Facts the assistant repeats back to customers, and the rules that tell it when to stop and fetch a person instead."
              />
            </CardHeader>
            <CardContent>
              <BusinessMemoryForm profile={memory.profile} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardHeading
                title="When you are open"
                description="Used to answer are you open, and to decide which booking times it may offer."
              />
            </CardHeader>
            <CardContent>
              <HoursForm hours={memory.hours} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardHeading
                title="Where you are"
                description="Branches, the areas you deliver to, and any address a customer might ask directions to."
              />
            </CardHeader>
            <CardContent className="space-y-5">
              <LocationForm />
              {memory.locations.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Timezone</TableHead>
                      <TableHead className="text-end">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {memory.locations.map((location) => (
                      <TableRow key={location.id}>
                        <TableCell className="font-medium">{location.name}</TableCell>
                        <TableCell>
                          {[location.address, location.city, location.country]
                            .filter(Boolean)
                            .join(', ') || '-'}
                        </TableCell>
                        <TableCell>{location.phone ?? '-'}</TableCell>
                        <TableCell>{location.timezone ?? '-'}</TableCell>
                        <TableCell className="text-end">
                          <DeleteButton
                            id={location.id}
                            action={deleteLocationAction}
                            label="Delete this location"
                            question={`${location.name} is removed from the addresses your assistant can give out. This cannot be undone.`}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                // Module 1 — the add form sits directly above, so no button is needed here.
                <EmptyState
                  title="No locations yet."
                  body={
                    <>
                      Add each branch or service area you cover so the assistant can answer
                      &ldquo;where are you&rdquo; and &ldquo;do you deliver to me&rdquo; without
                      guessing.
                    </>
                  }
                />
              )}
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      key: 'services',
      label: 'Services',
      helper: 'Add the products, services, packages, demos, or offers customers ask about.',
      badge: String(memory.services.length),
      content: (
        <ListAndAdd
          isEmpty={memory.services.length === 0}
          addId="add-service"
          addTitle="Add a service or offer"
          addDescription="Anything a customer can buy or book. The assistant only recommends what is on this list, so it will not invent a package you do not sell."
          firstRunDescription="List what you sell, with prices, and the assistant can answer cost and availability questions instead of asking customers to call you. It only recommends what is on this list, so it will not invent a package you do not sell."
          form={<ServiceForm defaultCurrency={memory.profile.defaultCurrency} />}
          listTitle="Existing services and offers"
          list={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Booking</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memory.services.map((service) => (
                  <Fragment key={service.id}>
                    <TableRow>
                      <TableCell className="font-medium">{service.name}</TableCell>
                      <TableCell>{categoryLabel(service.category)}</TableCell>
                      <TableCell>{servicePrice(service)}</TableCell>
                      <TableCell>{service.bookingRequired ? 'Required' : 'Optional'}</TableCell>
                      <TableCell className="text-end">
                        <DeleteButton
                          id={service.id}
                          action={deleteServiceAction}
                          label="Delete this service"
                          question={`Your assistant stops offering ${service.name} to customers. This cannot be undone.`}
                        />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={5}>
                        <EditDisclosure label="Edit service" name={service.name}>
                          <EditServiceForm
                            service={service}
                            defaultCurrency={memory.profile.defaultCurrency}
                          />
                        </EditDisclosure>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          }
        />
      ),
    },
    {
      key: 'policies',
      label: 'Policies',
      helper:
        'Add delivery, refunds, privacy, pricing, and support rules the assistant should answer from.',
      badge: String(memory.policies.length),
      content: (
        <ListAndAdd
          isEmpty={memory.policies.length === 0}
          addId="add-policy"
          addTitle="Add policy"
          addDescription="Policies are also indexed into knowledge so the assistant can quote them accurately."
          firstRunDescription="Add your refund, delivery or privacy policy and the assistant quotes it exactly instead of guessing. Policies are also indexed into knowledge, so it can answer around them too."
          form={<PolicyForm />}
          listTitle="Existing policies"
          list={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Preview</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memory.policies.map((policy) => (
                  <Fragment key={policy.id}>
                    <TableRow>
                      <TableCell className="font-medium">{policy.title}</TableCell>
                      <TableCell>{categoryLabel(policy.category)}</TableCell>
                      <TableCell className="max-w-md truncate text-muted-foreground">
                        {policy.content}
                      </TableCell>
                      <TableCell className="text-end">
                        <DeleteButton
                          id={policy.id}
                          action={deletePolicyAction}
                          label="Delete this policy"
                          question="Your assistant stops quoting this policy and will say it does not know instead. This cannot be undone."
                        />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={4}>
                        <EditDisclosure label="Edit policy" name={policy.title}>
                          <EditPolicyForm policy={policy} />
                        </EditDisclosure>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          }
        />
      ),
    },
    {
      key: 'faqs',
      label: 'FAQs',
      helper: 'Add exact answers for common customer questions.',
      badge: String(memory.faqs.length),
      content: (
        <ListAndAdd
          isEmpty={memory.faqs.length === 0}
          addId="add-faq"
          addTitle="Add FAQ"
          addDescription="Best for questions where you want the assistant to use a precise approved answer."
          firstRunDescription="The fastest way to improve answers: add the five questions customers ask you most, with the exact wording you want repeated back."
          form={<FaqForm />}
          listTitle="Existing FAQs"
          list={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  <TableHead>Answer</TableHead>
                  <TableHead>Topic</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memory.faqs.map((faq) => (
                  <Fragment key={faq.id}>
                    <TableRow>
                      <TableCell className="font-medium">{faq.question}</TableCell>
                      <TableCell className="max-w-md truncate text-muted-foreground">
                        {faq.answer}
                      </TableCell>
                      <TableCell>{categoryLabel(faq.category)}</TableCell>
                      <TableCell className="text-end">
                        <DeleteButton
                          id={faq.id}
                          action={deleteFaqAction}
                          label="Delete this answer"
                          question="Your assistant stops using this saved answer. This cannot be undone."
                        />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={4}>
                        <EditDisclosure label="Edit FAQ" name={faq.question}>
                          <EditFaqForm faq={faq} />
                        </EditDisclosure>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          }
        />
      ),
    },
    {
      key: 'knowledge',
      label: 'Knowledge',
      helper:
        'Upload up to 3 small files, import web pages, or paste trusted text. The assistant searches this before answering.',
      badge: String(docs.length),
      content: (
        <ListAndAdd
          isEmpty={docs.length === 0}
          addId="add-knowledge"
          addTitle="Add knowledge"
          addDescription="Use this for small files, pages, support docs, pricing pages, or longer text. Keep it concise to control AI cost."
          firstRunDescription="Paste your website address and we will read your public pages for you — that is usually the whole job. You can also upload a small file or paste text you trust. Keep it concise to control AI cost."
          form={<KnowledgeForm bots={botOptions} uploadedFileCount={uploadedFileCount} />}
          listTitle="Knowledge documents"
          list={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Assistant</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((doc) => {
                  // Editing is offered wherever this database holds the
                  // only copy of the text; where something else owns and
                  // rewrites it, the row says so instead of quietly
                  // dropping the button. See `documentEditRefusal`.
                  const refusal = documentEditRefusal(doc);
                  return (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium">{doc.title}</TableCell>
                      <TableCell>{doc.botName ?? 'All'}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {companyLabel('documentStatus', doc.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatNumber(doc.charCount)} chars</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(doc.createdAt)}
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex flex-col items-end gap-2">
                          {refusal ? (
                            <p className="max-w-[22rem] text-start text-xs text-muted-foreground">
                              {refusal}
                            </p>
                          ) : (
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/company/business-data/documents/${doc.id}`}>
                                Edit this text
                                <span className="sr-only">: {doc.title}</span>
                              </Link>
                            </Button>
                          )}
                          <DeleteButton
                            id={doc.id}
                            fieldName="documentId"
                            action={deleteDocumentAction}
                            label="Delete this file"
                            question={`${doc.title} and everything your assistant learned from it are removed. This cannot be undone.`}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          }
        />
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="My business info"
        description="Everything your assistant knows about you: where you are, when you are open, what you sell, your policies, and the questions you are asked most. Change anything here and it starts using it straight away."
        actions={
          <Badge
            variant={
              memory.readiness.percent >= 80
                ? 'success'
                : memory.readiness.percent >= 50
                  ? 'warning'
                  : 'secondary'
            }
          >
            {memory.readiness.percent}% ready
          </Badge>
        }
      />

      {/* Five tiles, so `lg:grid-cols-5` gives each about 230px at max-w-7xl —
          which works, until the browser is 1024px wide and each one is 190px
          holding "Assistants" and a number. `auto-fit` with a 10rem floor drops
          to three-and-two, then two, then one, at the widths where it has to. */}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))]">
        <StatTile label="Services" value={memory.services.length} />
        <StatTile label="Policies" value={memory.policies.length} />
        <StatTile label="FAQs" value={memory.faqs.length} />
        <StatTile label="Documents" value={docs.length} />
        <StatTile label="Assistants" value={bots.length} />
      </div>

      <BusinessDataTabs tabs={tabs} />
    </div>
  );
}
