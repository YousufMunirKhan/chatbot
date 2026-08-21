import { redirect } from 'next/navigation';

/**
 * Business Profile merged into Business Data (Module 5). Both screens rendered
 * the same forms against the same rows; Business Data is the superset and owns
 * the knowledge tab as well. Kept as a redirect so existing links and bookmarks
 * — including the Quality room's "fix this" CTAs — keep working.
 */
export default function CompanyProfilePage() {
  redirect('/company/business-data?tab=basics');
}
