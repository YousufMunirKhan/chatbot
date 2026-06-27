import { BrandedLogin } from './branded-login';

export const metadata = { title: 'Sign in - Switch & Save AI Assistant' };

export default async function LoginPage() {
  const missingSupabase =
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let form: React.ReactNode;
  if (missingSupabase) {
    form = (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">Supabase is not configured on this server.</p>
        <p className="mt-2">
          Add <span className="font-mono">NEXT_PUBLIC_SUPABASE_URL</span> and{' '}
          <span className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> to the live environment, then restart the app.
        </p>
      </div>
    );
  } else {
    const { LoginForm } = await import('./login-form');
    form = <LoginForm />;
  }

  return (
    <BrandedLogin
      form={form}
    />
  );
}
