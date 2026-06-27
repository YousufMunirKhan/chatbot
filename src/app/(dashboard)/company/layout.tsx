import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';

/**
 * Guards the entire /company subtree. Only company admins and agents may enter;
 * a super admin landing here is redirected to the platform area. Cross-company
 * data access is additionally prevented by RLS (migration 0002/0003).
 */
export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  return <>{children}</>;
}
