import Image from 'next/image';
import { ResetPasswordForm } from './reset-password-form';

export const metadata = { title: 'Set new password - Switch & Save AI Assistant' };

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-sidebar px-6 py-10">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl shadow-blue-950/20 sm:p-10">
        <div className="mb-8 space-y-5">
          <div className="inline-flex rounded-2xl border bg-white p-3">
            <Image src="/brand/switch-save-logo.png" alt="Switch & Save" width={220} height={44} priority className="h-auto w-56" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Set a new password</h1>
            <p className="mt-2 text-sm text-slate-500">Choose a secure password for your dashboard account.</p>
          </div>
        </div>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
