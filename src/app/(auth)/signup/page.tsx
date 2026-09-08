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
   *
   * "AI replies", NOT "AI conversations". `messageLimit` counts one thing: rows
   * in `ai_usage_logs` with `operation_type = 'chat'`, which is one message
   * written by the assistant. The pricing page's own FAQ spells that out — a
   * customer asking four questions in one chat spends four. Calling the same
   * number "conversations" here overstated the trial by however many turns a
   * chat takes, so someone signing up for "100 AI conversations" was really
   * being sold something closer to 25. Every surface that shows this number now
   * says "AI replies"; if that wording is changed here it has to change on the
   * pricing page, the billing page and the usage page in the same breath.
   */
  const trial = PLANS.free_trial;
  const terms = [
    `${trial.trialDays} days free, no card needed`,
    `${trial.messageLimit} AI replies included — one reply is one message from the assistant`,
    `£${trial.includedCreditGbp} of AI credit, which is what pays the model for those replies`,
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
