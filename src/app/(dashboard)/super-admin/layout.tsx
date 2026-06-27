import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { redirect } from 'next/navigation';

/**
 * Guards the entire /super-admin subtree. Non-super-admins are redirected to
 * their own home (Access Rule: "Super admin can access all platform data";
 * everyone else is blocked).
 */
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole([ROLES.SUPER_ADMIN]);
  if (user.impersonation) redirect('/company');
  return <>{children}</>;
}
