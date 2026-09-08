import { AuthShell, AuthLink } from '../auth-shell';
import { DEFAULT_BRANDING, type AgencyBranding } from '@/lib/agency';

/**
 * Sign in, in the shared auth layout.
 *
 * This file used to be the layout as well as the page: its own two-column grid,
 * its own `rounded-3xl` white card, its own heading scale and its own footer.
 * All of that now lives in `../auth-shell`, which the other five auth screens
 * use too, so "sign in" and "create an account" finally look like one product.
 * What is left here is the part that is genuinely about signing in.
 */
export function BrandedLogin({
  form,
  /** White-label branding for the agency serving this host (migration 0057). */
  branding = DEFAULT_BRANDING,
}: {
  form: React.ReactNode;
  branding?: AgencyBranding;
}) {
  return (
    <AuthShell
      branding={branding}
      title="Welcome back"
      description="Sign in to manage your assistant, your inbox and your customers."
      footer={
        <>
          <AuthLink href="/forgot-password">Forgot your password?</AuthLink>
          <AuthLink href="/customer-onboarding">How setup works</AuthLink>
        </>
      }
      // Until self-serve signup existed there was nowhere to send somebody who
      // had not got an account, so this page quietly assumed everyone arriving
      // already had one.
      altAction={{ question: 'New here?', label: 'Create an account', href: '/signup' }}
    >
      {form}
    </AuthShell>
  );
}
