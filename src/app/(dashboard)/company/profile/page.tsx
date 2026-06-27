import { Fragment } from 'react';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCurrentCompany } from '@/modules/company/data';
import { getBusinessMemory } from '@/modules/company/business-profile-data';
import {
  deleteFaqAction,
  deleteLocationAction,
  deletePolicyAction,
  deleteServiceAction,
} from '@/modules/company/business-profile-actions';
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
import { categoryLabel } from '@/modules/company/business-categories';

function DeleteButton({ id, action }: { id: string; action: (formData: FormData) => Promise<void> }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm">
        Delete
      </Button>
    </form>
  );
}

export default async function CompanyProfilePage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [company, memory] = await Promise.all([getCurrentCompany(), getBusinessMemory()]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Business Profile</h1>
          <p className="text-sm text-muted-foreground">
            The structured memory your assistants use for accurate answers, leads, and handoff.
          </p>
        </div>
        <Badge variant={memory.readiness.percent >= 80 ? 'success' : memory.readiness.percent >= 50 ? 'warning' : 'secondary'}>
          {memory.readiness.percent}% ready
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Readiness checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {memory.readiness.items.map((item) => (
              <div key={item.key} className="rounded-md border p-3 text-sm">
                <div className="font-medium">{item.label}</div>
                <div className={item.complete ? 'text-emerald-600' : 'text-muted-foreground'}>
                  {item.complete ? 'Complete' : 'Missing'}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Basic company record</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm company={company} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Business memory</CardTitle>
        </CardHeader>
        <CardContent>
          <BusinessMemoryForm profile={memory.profile} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Business hours</CardTitle>
        </CardHeader>
        <CardContent>
          <HoursForm hours={memory.hours} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Locations</CardTitle>
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
                {memory.locations.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">
                      {l.name} {l.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
                    </TableCell>
                    <TableCell>{[l.address, l.city, l.country].filter(Boolean).join(', ') || '-'}</TableCell>
                    <TableCell>{l.phone ?? '-'}</TableCell>
                    <TableCell>{l.timezone ?? '-'}</TableCell>
                    <TableCell className="text-right">
                      <DeleteButton id={l.id} action={deleteLocationAction} />
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

      <Card id="services">
        <CardHeader>
          <CardTitle>Services and offers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <ServiceForm defaultCurrency={memory.profile.defaultCurrency} />
          {memory.services.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Offer type</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Booking</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memory.services.map((s) => (
                  <Fragment key={s.id}>
                    <TableRow>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{categoryLabel(s.category)}</TableCell>
                      <TableCell>
                        {s.priceFrom || s.priceTo
                          ? `${s.priceFrom ?? s.priceTo}${s.priceTo && s.priceFrom !== s.priceTo ? `-${s.priceTo}` : ''} ${s.currency}`
                          : '-'}
                      </TableCell>
                      <TableCell>{s.bookingRequired ? 'Required' : 'Optional'}</TableCell>
                      <TableCell className="text-right">
                        <DeleteButton id={s.id} action={deleteServiceAction} />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={5}>
                        <details>
                          <summary className="cursor-pointer text-sm font-medium text-primary">Edit service</summary>
                          <EditServiceForm service={s} defaultCurrency={memory.profile.defaultCurrency} />
                        </details>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No services added yet.</p>
          )}
        </CardContent>
      </Card>

      <Card id="policies">
        <CardHeader>
          <CardTitle>Policies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <PolicyForm />
          {memory.policies.length ? (
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
                {memory.policies.map((p) => (
                  <Fragment key={p.id}>
                    <TableRow>
                      <TableCell className="font-medium">{p.title}</TableCell>
                      <TableCell>{categoryLabel(p.category)}</TableCell>
                      <TableCell className="max-w-md truncate text-muted-foreground">{p.content}</TableCell>
                      <TableCell className="text-right">
                        <DeleteButton id={p.id} action={deletePolicyAction} />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={4}>
                        <details>
                          <summary className="cursor-pointer text-sm font-medium text-primary">Edit policy</summary>
                          <EditPolicyForm policy={p} />
                        </details>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No policies added yet.</p>
          )}
        </CardContent>
      </Card>

      <Card id="faqs">
        <CardHeader>
          <CardTitle>FAQs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <FaqForm />
          {memory.faqs.length ? (
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
                {memory.faqs.map((f) => (
                  <Fragment key={f.id}>
                    <TableRow>
                      <TableCell className="font-medium">{f.question}</TableCell>
                      <TableCell className="max-w-md truncate text-muted-foreground">{f.answer}</TableCell>
                      <TableCell>{categoryLabel(f.category)}</TableCell>
                      <TableCell className="text-right">
                        <DeleteButton id={f.id} action={deleteFaqAction} />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={4}>
                        <details>
                          <summary className="cursor-pointer text-sm font-medium text-primary">Edit FAQ</summary>
                          <EditFaqForm faq={f} />
                        </details>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No FAQs added yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
