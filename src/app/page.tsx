import { redirect } from 'next/navigation';

/**
 * The bare domain now lands on pricing, not on a login form.
 *
 * Sending a stranger to `/login` assumed everybody arriving already had an
 * account — which was true while the only way in was an operator creating one.
 * With self-serve signup and a public pricing page, the root URL was the last
 * door that only opened inwards.
 *
 * Signed-in users lose nothing: `/pricing` carries a Sign in button, and
 * `src/middleware.ts` still bounces anyone hitting /company, /super-admin or
 * /dashboard without a session straight to /login.
 */
export default function HomePage() {
  redirect('/pricing');
}
