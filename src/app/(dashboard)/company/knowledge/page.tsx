import { redirect } from 'next/navigation';

/**
 * Knowledge merged into Business Data (Module 5). Same editor, same documents —
 * it is now the "Knowledge" tab. Kept as a redirect so existing links and
 * bookmarks keep working.
 */
export default function CompanyKnowledgePage() {
  redirect('/company/business-data?tab=knowledge');
}
