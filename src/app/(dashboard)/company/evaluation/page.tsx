import { redirect } from 'next/navigation';

/**
 * Evaluation merged into the company "Quality room" (suggestions hub). Raw eval
 * scores are now super-admin only; companies see actionable suggestions.
 */
export default function EvaluationPage() {
  redirect('/company/quality');
}
