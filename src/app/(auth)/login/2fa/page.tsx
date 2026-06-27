import { TwoFactorForm } from './two-factor-form';

export default function TwoFactorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-8">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-background p-6 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Two-factor verification</h1>
          <p className="text-sm text-muted-foreground">Enter the code sent to your email.</p>
        </div>
        <TwoFactorForm />
      </div>
    </main>
  );
}
