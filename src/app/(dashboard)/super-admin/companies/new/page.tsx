import Link from 'next/link';
import { CompanyForm } from '@/modules/super-admin/components/company-form';

export default function NewCompanyPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/super-admin/companies" className="text-sm text-muted-foreground hover:underline">
            Back to companies
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Onboard a company</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Create the tenant, first company-admin login, subscription limits, and AI cost controls in one flow.
          </p>
        </div>

        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3 lg:w-[520px]">
          <div className="rounded-md border bg-card p-3">
            <p className="font-medium text-foreground">1. Tenant</p>
            <p className="mt-1 text-xs">Company and owner login.</p>
          </div>
          <div className="rounded-md border bg-card p-3">
            <p className="font-medium text-foreground">2. Commercials</p>
            <p className="mt-1 text-xs">Plan, limits, trial, overage.</p>
          </div>
          <div className="rounded-md border bg-card p-3">
            <p className="font-medium text-foreground">3. AI risk</p>
            <p className="mt-1 text-xs">Budget cap, hard stop, cache.</p>
          </div>
        </div>
      </div>

      <CompanyForm />
    </div>
  );
}
