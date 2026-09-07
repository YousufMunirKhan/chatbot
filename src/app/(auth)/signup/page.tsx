import Image from 'next/image';
import Link from 'next/link';
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
    <main className="flex min-h-screen items-center justify-center bg-brand-sidebar px-6 py-10">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl shadow-blue-950/20 sm:p-10">
        <div className="mb-8 space-y-5">
          <div className="inline-flex rounded-2xl border bg-white p-3">
            <Image
              src="/brand/switch-save-logo.png"
              alt="Switch & Save"
              width={220}
              height={44}
              priority
              className="h-auto w-56"
            />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Start your free trial</h1>
            <p className="mt-2 text-sm text-slate-500">
              Create your account and your assistant is ready in a minute.
            </p>
          </div>
          <ul className="space-y-2 text-sm text-slate-600">
            {terms.map((term) => (
              <li key={term} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-black text-emerald-700"
                >
                  +
                </span>
                {term}
              </li>
            ))}
          </ul>
        </div>
        <SignUpForm />
        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
