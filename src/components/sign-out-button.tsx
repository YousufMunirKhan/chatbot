import { signOutAction } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';

/**
 * Sign-out control. Submits the server action via a form (no client JS needed).
 *
 * `label` is optional so the
 * untranslated call sites keep the English wording (Module 21 translation).
 */
export function SignOutButton({ label = 'Sign out' }: { label?: string }) {
  return (
    <form action={signOutAction}>
      <Button variant="ghost" size="sm" type="submit">
        {label}
      </Button>
    </form>
  );
}
