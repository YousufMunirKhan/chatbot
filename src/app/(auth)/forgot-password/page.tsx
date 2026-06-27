import Image from 'next/image';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata = { title: 'Forgot password - Switch & Save AI Assistant' };

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-sidebar px-6 py-10">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl shadow-blue-950/20 sm:p-10">
        <div className="mb-8 space-y-5">
          <div className="inline-flex rounded-2xl border bg-white p-3">
            <Image src="/brand/switch-save-logo.png" alt="Switch & Save" width={220} height={44} priority className="h-auto w-56" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Reset your password</h1>
            <p className="mt-2 text-sm text-slate-500">Enter your email and we will send a secure reset link.</p>
          </div>
        </div>
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
