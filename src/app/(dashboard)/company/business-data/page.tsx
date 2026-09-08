import { Fragment } from 'react';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { companyLabel } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.key} className="rounded-md border p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
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

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
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
              <SectionHeader
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
              <SectionHeader
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
              <SectionHeader
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
              <SectionHeader
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
        // Desktop: what you already have on the left, the form that adds
        // another on the right, sticky. Stacked, you scrolled past the form
        // every single time to reach the list you came to check. Grid tracks
        // are positional, so column 1 (the list, ordered first) is the wide one.
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
          <Card id="add-service" className="lg:sticky lg:top-6 lg:order-2 lg:self-start">
            <CardHeader>
              <SectionHeader
                title="Add a service or offer"
                description="Anything a customer can buy or book. The assistant only recommends what is on this list, so it will not invent a package you do not sell."
              />
            </CardHeader>
            <CardContent>
              <ServiceForm defaultCurrency={memory.profile.defaultCurrency} />
            </CardContent>
          </Card>

          <Card className="lg:order-1">
            <CardHeader>
              <CardTitle>Existing services and offers</CardTitle>
            </CardHeader>
            <CardContent>
              {memory.services.length === 0 ? (
                // Module 2 — empty state points back to the add form on this same tab.
                <EmptyState
                  title="No services yet."
                  body="List what you sell, with prices, and the assistant can answer cost and availability questions instead of asking customers to call you."
                  action={
                    <Button asChild size="sm">
                      <a href="#add-service">Add a service</a>
                    </Button>
                  }
                />
              ) : (
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
                            <details>
                              <summary className="cursor-pointer text-sm font-medium text-primary">
                                Edit service
                              </summary>
                              <EditServiceForm
                                service={service}
                                defaultCurrency={memory.profile.defaultCurrency}
                              />
                            </details>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      key: 'policies',
      label: 'Policies',
      helper:
        'Add delivery, refunds, privacy, pricing, and support rules the assistant should answer from.',
      badge: String(memory.policies.length),
      content: (
        // Desktop: what you already have on the left, the form that adds
        // another on the right, sticky. Stacked, you scrolled past the form
        // every single time to reach the list you came to check. Grid tracks
        // are positional, so column 1 (the list, ordered first) is the wide one.
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
          <Card id="add-policy" className="lg:sticky lg:top-6 lg:order-2 lg:self-start">
            <CardHeader>
              <SectionHeader
                title="Add policy"
                description="Policies are also indexed into knowledge so the assistant can quote them accurately."
              />
            </CardHeader>
            <CardContent>
              <PolicyForm />
            </CardContent>
          </Card>

          <Card className="lg:order-1">
            <CardHeader>
              <CardTitle>Existing policies</CardTitle>
            </CardHeader>
            <CardContent>
              {memory.policies.length === 0 ? (
                // Module 3 — highest-value empty state on this tab, so it carries a button.
                <EmptyState
                  title="No policies yet."
                  body="Add your refund, delivery, or privacy policy so the assistant quotes it exactly instead of guessing."
                  action={
                    <Button asChild size="sm">
                      <a href="#add-policy">Add a policy</a>
                    </Button>
                  }
                />
              ) : (
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
                            <details>
                              <summary className="cursor-pointer text-sm font-medium text-primary">
                                Edit policy
                              </summary>
                              <EditPolicyForm policy={policy} />
                            </details>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      key: 'faqs',
      label: 'FAQs',
      helper: 'Add exact answers for common customer questions.',
      badge: String(memory.faqs.length),
      content: (
        // Desktop: what you already have on the left, the form that adds
        // another on the right, sticky. Stacked, you scrolled past the form
        // every single time to reach the list you came to check. Grid tracks
        // are positional, so column 1 (the list, ordered first) is the wide one.
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
          <Card id="add-faq" className="lg:sticky lg:top-6 lg:order-2 lg:self-start">
            <CardHeader>
              <SectionHeader
                title="Add FAQ"
                description="Best for questions where you want the assistant to use a precise approved answer."
              />
            </CardHeader>
            <CardContent>
              <FaqForm />
            </CardContent>
          </Card>

          <Card className="lg:order-1">
            <CardHeader>
              <CardTitle>Existing FAQs</CardTitle>
            </CardHeader>
            <CardContent>
              {memory.faqs.length === 0 ? (
                // Module 4 — cheapest quality win, so the copy names the exact first step.
                <EmptyState
                  title="No FAQs yet."
                  body="The fastest way to improve answers: add the five questions customers ask most."
                  action={
                    <Button asChild size="sm">
                      <a href="#add-faq">Add an FAQ</a>
                    </Button>
                  }
                />
              ) : (
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
                            <details>
                              <summary className="cursor-pointer text-sm font-medium text-primary">
                                Edit FAQ
                              </summary>
                              <EditFaqForm faq={faq} />
                            </details>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      key: 'knowledge',
      label: 'Knowledge',
      helper:
        'Upload up to 3 small files, import web pages, or paste trusted text. The assistant searches this before answering.',
      badge: String(docs.length),
      content: (
        // Desktop: what you already have on the left, the form that adds
        // another on the right, sticky. Stacked, you scrolled past the form
        // every single time to reach the list you came to check. Grid tracks
        // are positional, so column 1 (the list, ordered first) is the wide one.
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
          <Card id="add-knowledge" className="lg:sticky lg:top-6 lg:order-2 lg:self-start">
            <CardHeader>
              <SectionHeader
                title="Add knowledge"
                description="Use this for small files, pages, support docs, pricing pages, or longer text. Keep it concise to control AI cost."
              />
            </CardHeader>
            <CardContent>
              <KnowledgeForm bots={botOptions} uploadedFileCount={uploadedFileCount} />
            </CardContent>
          </Card>

          <Card className="lg:order-1">
            <CardHeader>
              <CardTitle>Knowledge documents</CardTitle>
            </CardHeader>
            <CardContent>
              {docs.length === 0 ? (
                // Module 5 — website import is the least work for the owner, so lead with it.
                <EmptyState
                  title="Nothing imported yet."
                  body={
                    <>Paste your website address and we&rsquo;ll read your public pages for you.</>
                  }
                  action={
                    <Button asChild size="sm">
                      <a href="#add-knowledge">Import my website</a>
                    </Button>
                  }
                />
              ) : (
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
              )}
            </CardContent>
          </Card>
        </div>
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
