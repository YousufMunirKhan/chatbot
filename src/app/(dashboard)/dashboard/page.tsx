import { redirect } from 'next/navigation';
import { requireUser, homePathFor } from '@/lib/auth';

/**
 * Entry router: send each signed-in user to the area for their role
 * (super admin → /super-admin, company admin → /company, agent → /company/inbox).
 */
export default async function DashboardHome() {
  const user = await requireUser();
  redirect(homePathFor(user));
}
