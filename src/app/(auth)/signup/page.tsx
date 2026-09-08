import { AuthShell, AuthLink } from '../auth-shell';
import { PLANS } from '@/modules/super-admin/plans';
import { SignUpForm } from './signup-form';

export const metadata = {
  title: 'Create your account - Switch & Save AI Assistant',
  description: 'Start a free trial of the Switch & Save AI assistant for your business.',
};

export default function SignUpPage() {
  /*
   * The trial's terms are read from the plan catalogue rather than typed into
   * the copy, because the signup action provisions on `PLANS.free_trial` and a
   * promise on this page that no longer matches what the account gets is the
   * kind of thing nobody notices until a customer counts their messages.
   */
  const trial = PLANS.free_trial;
  const terms = [
    `${trial.trialDays} days free, no card needed`,
    `${trial.messageLimit} AI conversations included`,
    `£${trial.includedCreditGbp} of AI credit to get started`,
  ];

  return (
    <AuthShell
      title="Start your free trial"
      description="Create your account and your assistant is ready in a minute."
      altAction={{ question: 'Already have an account?', label: 'Sign in', href: '/login' }}
    >
      {/* The trial's terms sit above the form rather than beside it: on a phone
          a two-column arrangement would have put them below the submit button,
          where they answer a question the reader has already stopped asking.
          `bg-emerald-100 text-emerald-700` on the tick became the success
          triplet, which exists in dark mode. */}
      <ul className="mb-6 space-y-2 rounded-md border bg-muted/40 p-4 text-sm">
        {terms.map((term) => (
          <li key={term} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success-bg text-[10px] font-semibold text-success-fg"
            >
              ✓
            </span>
            <span>{term}</span>
          </li>
        ))}
      </ul>

      <SignUpForm />

      {/* A stranger creating an account is entitled to know what happens after
          the trial before they type anything, not after. */}
      <p className="mt-4 text-xs text-muted-foreground">
        No card is taken now. See what it costs after the trial on the{' '}
        <AuthLink href="/pricing">pricing page</AuthLink>.
      </p>
    </AuthShell>
  );
}
