import { AuthShell, AuthLink } from '../auth-shell';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata = { title: 'Forgot password - Switch & Save AI Assistant' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email you sign in with and we will send you a secure reset link."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
      altAction={{ question: 'No account yet?', label: 'Create one', href: '/signup' }}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
