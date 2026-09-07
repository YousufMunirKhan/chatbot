import Image from 'next/image';
import Link from 'next/link';
import { DEFAULT_BRANDING, type AgencyBranding } from '@/lib/agency';

export function BrandedLogin({
  form,
  /** White-label branding for the agency serving this host (migration 0057). */
  branding = DEFAULT_BRANDING,
}: {
  form: React.ReactNode;
  branding?: AgencyBranding;
}) {
  return (
    <main className="grid min-h-screen bg-[#eef3fb] text-slate-950 lg:grid-cols-[1.05fr_1fr]">
      <section
        // On a phone this panel stacks ABOVE the form, so a fixed 42rem height
        // pushed the email field 1147px down a 812px screen — a customer had to
        // scroll more than a full screen to find the sign-in box. The tall
        // treatment now starts at lg, where it is a side column and costs
        // nothing, and on small screens the form is ordered first.
        className="relative order-2 flex flex-col overflow-hidden bg-brand-sidebar bg-cover bg-center px-6 py-8 text-white sm:px-10 lg:order-1 lg:min-h-screen lg:px-14"
        style={
          branding.loginBackground ? { backgroundImage: `url(${branding.loginBackground})` } : undefined
        }
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(255,255,255,0.12),transparent_28%),linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:auto,28px_28px,28px_28px]" />
        <div className="relative z-10 flex flex-1 flex-col">
          <div className="inline-flex w-fit rounded-2xl bg-white p-4 shadow-2xl shadow-blue-950/20">
            {branding.logoUrl ? (
              // An agency's logo is on a host we do not control, so next/image
              // would need it in `remotePatterns` to render at all.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logoUrl}
                alt={branding.productName}
                className="h-auto max-h-[52px] w-64 object-contain"
              />
            ) : (
              <Image src="/brand/switch-save-logo.png" alt={branding.productName} width={260} height={52} priority className="h-auto w-64" />
            )}
          </div>

          <div className="mt-12 max-w-2xl space-y-6">
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Run service, sales, and customer chat from one place.
            </h1>
            <p className="max-w-xl text-lg font-medium text-blue-100">
              Manage your {branding.productName} AI assistant, live chats, leads, appointments, and business knowledge with a clean operator dashboard.
            </p>
            <div className="space-y-3 text-sm font-semibold text-blue-50">
              {['AI support with human handoff', 'Leads, appointments, and customer inbox', 'Business knowledge, policies, and quick actions'].map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-xs font-black text-emerald-950">OK</span>
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-auto grid gap-3 pt-10 sm:grid-cols-3">
            {[
              ['99.9%', 'uptime focus'],
              ['24/7', 'AI availability'],
              ['Human', 'takeover ready'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-lg border border-white/15 bg-white/10 p-4 backdrop-blur">
                <div className="text-2xl font-extrabold">{value}</div>
                <div className="text-xs font-bold uppercase tracking-wide text-blue-100">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="order-1 flex items-center justify-center px-6 py-10 lg:order-2">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl shadow-blue-950/10 sm:p-10">
          <div className="mb-8 space-y-2">
            <h2 className="text-2xl font-extrabold tracking-tight">Welcome back</h2>
            <p className="text-sm text-slate-500">Sign in to manage your AI assistant dashboard.</p>
          </div>
          {form}
          <div className="mt-5 flex items-center justify-between text-sm">
            <Link href="/forgot-password" className="font-medium text-primary hover:underline">
              Forgot password?
            </Link>
            <Link href="/customer-onboarding" className="font-medium text-primary hover:underline">
              See onboarding
            </Link>
          </div>
          <p className="mt-8 text-center text-xs text-slate-500">{branding.productName} - AI Assistant Platform &copy; 2026</p>
        </div>
      </section>
    </main>
  );
}
