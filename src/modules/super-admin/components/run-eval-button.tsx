'use client';

import { SubmitButton } from '@/components/ui/submit-button';
import { runCompanyGradedEvalAction } from '../actions';

/** Runs a graded eval with visible pending state (it takes ~20–40s). */
export function RunEvalButton({ companyId }: { companyId: string }) {
  return (
    <form action={runCompanyGradedEvalAction}>
      <input type="hidden" name="companyId" value={companyId} />
      <SubmitButton size="sm" pendingLabel="Running evaluation…">
        Run graded evaluation
      </SubmitButton>
    </form>
  );
}
