import { headers } from 'next/headers';
import { BrandedLogin } from './branded-login';
import { DEFAULT_BRANDING, getAgencyByDomain } from '@/lib/agency';

export const metadata = { title: 'Sign in - Switch & Save AI Assistant' };

export default async function LoginPage() {
  /*
   * White-label branding on the login page (migration 0057).
   *
   * There is no session here, so the company — and therefore its agency —
   * cannot be looked up by user. The host is the only signal available before
   * sign-in, which is exactly what an agency's `custom_domain` is for. On the
   * platform's own domain this resolves to `null` and the page renders
   * unchanged. Memoised in `src/lib/agency.ts`, so it is not a query per visit.
   */
  const agency = await getAgencyByDomain(headers().get('host'));
  const branding = agency?.branding ?? DEFAULT_BRANDING;
  const missingSupabase =
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let form: React.ReactNode;
  if (missingSupabase) {
    form = (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">Supabase is not configured on this server.</p>
        <p className="mt-2">
          Add <span className="font-mono">NEXT_PUBLIC_SUPABASE_URL</span> and{' '}
          <span className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> to the live environment, then restart the app.
        </p>
      </div>
    );
  } else {
    const { LoginForm } = await import('./login-form');
    form = <LoginForm />;
  }

  return (
    <BrandedLogin
      form={form}
      branding={branding}
    />
  );
}
