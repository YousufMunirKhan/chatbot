'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { runCompanyGradedEvalAction } from '../actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Running evaluation…' : 'Run graded evaluation'}
    </Button>
  );
}

/** Runs a graded eval with visible pending state (it takes ~20–40s). */
export function RunEvalButton({ companyId }: { companyId: string }) {
  return (
    <form action={runCompanyGradedEvalAction}>
      <input type="hidden" name="companyId" value={companyId} />
      <Submit />
    </form>
  );
}
