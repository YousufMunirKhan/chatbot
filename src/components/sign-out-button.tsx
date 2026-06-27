import { signOutAction } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';

/** Sign-out control. Submits the server action via a form (no client JS needed). */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button variant="ghost" size="sm" type="submit">
        Sign out
      </Button>
    </form>
  );
}
