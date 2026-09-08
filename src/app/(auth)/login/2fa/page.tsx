import { AuthShell, AuthLink } from '../../auth-shell';
import { TwoFactorForm } from './two-factor-form';

export const metadata = { title: 'Two-step sign-in' };

/**
 * The emailed-code half of two-step sign-in (migration 0018).
 *
 * Its sibling at `/two-factor` asks for an authenticator code and this one asks
 * for an emailed code; they are the same moment in the same journey, so they
 * now wear the same shell and say the same kind of thing. Before this they
 * differed in title style, card width and copy voice — "Two-factor
 * verification" against "One more step" — which made the emailed branch feel
 * like a fallback somebody had bolted on.
 */
export default function TwoFactorPage() {
  return (
    <AuthShell
      title="One more step"
      description="We have emailed you a six-digit code. Enter it here to finish signing in."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      <TwoFactorForm />
    </AuthShell>
  );
}
