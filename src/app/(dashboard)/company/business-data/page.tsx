import { Fragment } from 'react';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import {
  getBusinessMemory,
  type BusinessReadinessItem,
} from '@/modules/company/business-profile-data';
import { getCurrentCompany, listBots } from '@/modules/company/data';
import { listDocuments } from '@/modules/company/knowledge-data';
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
import { BusinessDataTabs, type BusinessDataTab } from '@/modules/company/components/business-data-tabs';
import { categoryLabel } from '@/modules/company/business-categories';

function DeleteButton({
  id,
  fieldName = 'id',
  action,
}: {
  id: string;
  fieldName?: string;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action}>
      <input type="hidden" name={fieldName} value={id} />
      <Button type="submit" variant="ghost" size="sm">
        Delete
      </Button>
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

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function servicePrice(service: { priceFrom: number | null; priceTo: number | null; currency: string }) {
  if (service.priceFrom == null && service.priceTo == null) return '-';
  if (service.priceFrom != null && service.priceTo != null && service.priceFrom !== service.priceTo) {
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
  const uploadedFileCount = docs.filter((doc) => ['pdf', 'docx', 'txt'].includes(doc.sourceType)).length;

  const tabs: BusinessDataTab[] = [
    {
      key: 'overview',
      label: 'Overview',
      helper: 'This explains what the assistant already understands and what still needs information.',
      badge: `${memory.readiness.percent}%`,
      content: (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>What “ready” means</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Ready means the assistant has enough saved business facts to answer that topic. Needs info means customers may get weak or incomplete answers for that topic until you add data.
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
      helper: 'Edit company identity, contact details, locations, opening hours, and handoff rules here.',
      content: (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <SectionHeader title="Company record" description="This is your account-level company name, website, language, country, and timezone." />
            </CardHeader>
            <CardContent>
              <ProfileForm company={company} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeader title="Assistant business memory" description="These facts are injected into assistant answers and handoff decisions." />
            </CardHeader>
            <CardContent>
              <BusinessMemoryForm profile={memory.profile} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeader title="Business hours" description="Used for opening-hours, availability, and appointment questions." />
            </CardHeader>
            <CardContent>
              <HoursForm hours={memory.hours} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeader title="Locations" description="Add branches, service areas, and public contact locations." />
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
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {memory.locations.map((location) => (
                      <TableRow key={location.id}>
                        <TableCell className="font-medium">{location.name}</TableCell>
                        <TableCell>{[location.address, location.city, location.country].filter(Boolean).join(', ') || '-'}</TableCell>
                        <TableCell>{location.phone ?? '-'}</TableCell>
                        <TableCell>{location.timezone ?? '-'}</TableCell>
                        <TableCell className="text-right">
                          <DeleteButton id={location.id} action={deleteLocationAction} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No locations added yet.</p>
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
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <SectionHeader title="Add service or offer" description="This fixes the Services or offers readiness item and helps the assistant answer sales questions." />
            </CardHeader>
            <CardContent>
              <ServiceForm defaultCurrency={memory.profile.defaultCurrency} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Existing services and offers</CardTitle>
            </CardHeader>
            <CardContent>
              {memory.services.length === 0 ? (
                <p className="text-sm text-muted-foreground">No services added yet. Add your first service above.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Booking</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
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
                          <TableCell className="text-right">
                            <DeleteButton id={service.id} action={deleteServiceAction} />
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={5}>
                            <details>
                              <summary className="cursor-pointer text-sm font-medium text-primary">Edit service</summary>
                              <EditServiceForm service={service} defaultCurrency={memory.profile.defaultCurrency} />
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
      helper: 'Add delivery, refunds, privacy, pricing, and support rules the assistant should answer from.',
      badge: String(memory.policies.length),
      content: (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <SectionHeader title="Add policy" description="Policies are also indexed into knowledge so the assistant can quote them accurately." />
            </CardHeader>
            <CardContent>
              <PolicyForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Existing policies</CardTitle>
            </CardHeader>
            <CardContent>
              {memory.policies.length === 0 ? (
                <p className="text-sm text-muted-foreground">No policies added yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Preview</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {memory.policies.map((policy) => (
                      <Fragment key={policy.id}>
                        <TableRow>
                          <TableCell className="font-medium">{policy.title}</TableCell>
                          <TableCell>{categoryLabel(policy.category)}</TableCell>
                          <TableCell className="max-w-md truncate text-muted-foreground">{policy.content}</TableCell>
                          <TableCell className="text-right">
                            <DeleteButton id={policy.id} action={deletePolicyAction} />
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={4}>
                            <details>
                              <summary className="cursor-pointer text-sm font-medium text-primary">Edit policy</summary>
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
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <SectionHeader title="Add FAQ" description="Best for questions where you want the assistant to use a precise approved answer." />
            </CardHeader>
            <CardContent>
              <FaqForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Existing FAQs</CardTitle>
            </CardHeader>
            <CardContent>
              {memory.faqs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No FAQs added yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Question</TableHead>
                      <TableHead>Answer</TableHead>
                      <TableHead>Topic</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {memory.faqs.map((faq) => (
                      <Fragment key={faq.id}>
                        <TableRow>
                          <TableCell className="font-medium">{faq.question}</TableCell>
                          <TableCell className="max-w-md truncate text-muted-foreground">{faq.answer}</TableCell>
                          <TableCell>{categoryLabel(faq.category)}</TableCell>
                          <TableCell className="text-right">
                            <DeleteButton id={faq.id} action={deleteFaqAction} />
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={4}>
                            <details>
                              <summary className="cursor-pointer text-sm font-medium text-primary">Edit FAQ</summary>
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
      helper: 'Upload up to 3 small files, import web pages, or paste trusted text. The assistant searches this before answering.',
      badge: String(docs.length),
      content: (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <SectionHeader title="Add knowledge" description="Use this for small files, pages, support docs, pricing pages, or longer text. Keep it concise to control AI cost." />
            </CardHeader>
            <CardContent>
              <KnowledgeForm bots={botOptions} uploadedFileCount={uploadedFileCount} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Knowledge documents</CardTitle>
            </CardHeader>
            <CardContent>
              {docs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No knowledge documents yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Assistant</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {docs.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium">{doc.title}</TableCell>
                        <TableCell>{doc.botName ?? 'All'}</TableCell>
                        <TableCell><Badge variant="secondary">{doc.status}</Badge></TableCell>
                        <TableCell>{formatNumber(doc.charCount)} chars</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(doc.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <DeleteButton id={doc.id} fieldName="documentId" action={deleteDocumentAction} />
                        </TableCell>
                      </TableRow>
                    ))}
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
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Business Data</h1>
          <p className="text-sm text-muted-foreground">
            Edit the facts your assistant uses. Pick a tab, make the change, save, and stay on this workspace.
          </p>
        </div>
        <Badge variant={memory.readiness.percent >= 80 ? 'success' : memory.readiness.percent >= 50 ? 'warning' : 'secondary'}>
          {memory.readiness.percent}% ready
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">Services</p><p className="mt-1 text-2xl font-semibold">{memory.services.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">Policies</p><p className="mt-1 text-2xl font-semibold">{memory.policies.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">FAQs</p><p className="mt-1 text-2xl font-semibold">{memory.faqs.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">Documents</p><p className="mt-1 text-2xl font-semibold">{docs.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">Assistants</p><p className="mt-1 text-2xl font-semibold">{bots.length}</p></CardContent></Card>
      </div>

      <BusinessDataTabs tabs={tabs} />
    </div>
  );
}
