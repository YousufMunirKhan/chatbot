import { headers } from 'next/headers';
import { Alert } from '@/components/ui/alert';
import { BrandedLogin } from './branded-login';
import { DEFAULT_BRANDING, getAgencyByDomain } from '@/lib/agency';

export const metadata = { title: 'Sign in - Switch & Save AI Assistant' };

/*
 * There is deliberately no "Continue with Google" button here.
 *
 * One used to exist as `./google-button.tsx`, written against
 * `supabase.auth.signInWithOAuth`, and nothing had ever imported it — it was
 * dead from the initial commit and rendered nowhere, so no customer has ever
 * signed in this way. It was removed rather than imported, because importing it
 * is not the one-line fix it looks like:
 *
 *  1. Supabase Auth does not read this app's GOOGLE_CLIENT_ID /
 *     GOOGLE_CLIENT_SECRET — those belong to the Gmail and YouTube channel
 *     connectors (`src/lib/channels/google-oauth.ts`) and are exchanged by our
 *     own server. The provider for sign-in is configured inside the Supabase
 *     project, with its own client and its own redirect URI, and that has not
 *     been done. Until it is, the button only ever answers "Unsupported
 *     provider".
 *
 *  2. Google would create the `auth.users` row itself, so the
 *     `on_auth_user_created` trigger (migration 0003) writes a `public.users`
 *     profile — and nothing else. No company, no `company_users` membership, no
 *     subscription, no credit wallet. `provisionCompany`
 *     (`src/modules/onboarding/provision.ts`) cannot adopt that person: it mints
 *     its own auth user from a password and refuses any email already present in
 *     `public.users`. So the profile row permanently blocks that address from
 *     completing /signup, and `homePathFor` sends a company-less user to
 *     /dashboard, which routes by calling `homePathFor` again — a redirect loop.
 *
 * Google sign-in is worth having, but it needs a provisioning path for an
 * identity that already exists before the tenant does. Wire that first.
 */
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
    // `border-amber-200 bg-amber-50 text-amber-950` was three raw palette
    // values, none of which is defined in dark mode — on a dark screen this
    // notice was near-black text on a near-white plate. The warning triplet is
    // defined in both themes and contrast-checked against its own surface.
    form = (
      <Alert tone="warning" title="Supabase is not configured on this server.">
        <p>
          Add <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to the live environment,
          then restart the app.
        </p>
      </Alert>
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
