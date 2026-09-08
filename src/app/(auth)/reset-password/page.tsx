import { AuthShell, AuthLink } from '../auth-shell';
import { ResetPasswordForm } from './reset-password-form';

export const metadata = { title: 'Set new password - Switch & Save AI Assistant' };

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Set a new password"
      // Says what happens next, because it is not what people expect: saving
      // sends them back to the sign-in form to use the password they just set.
      description="Choose a password you have not used anywhere else. Once it is saved we will take you back to sign in with it."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
