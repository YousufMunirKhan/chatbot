'use client';

import { useRef, useTransition } from 'react';
import { Select } from '@/components/ui/select';
import { LEAD_STATUS_LABELS } from '@/lib/constants';
import { updateLeadStatusAction } from '@/modules/company/leads-actions';

/**
 * Change an enquiry's stage in one interaction.
 *
 * It used to be a `<select>` plus a separate "Update" button — two clicks per
 * row, and a silent no-op if you changed the dropdown and walked away. The
 * select now submits itself, and the whole control is disabled while the write
 * is in flight so a fast second change cannot race the first.
 */
export function LeadStatusSelect({
  leadId,
  status,
  selectId,
}: {
  leadId: string;
  status: string;
  /** Ties the control to a visible label rendered by the page. */
  selectId?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form ref={formRef} action={updateLeadStatusAction}>
      <input type="hidden" name="leadId" value={leadId} />
      <Select
        id={selectId}
        name="status"
        size="sm"
        defaultValue={status}
        disabled={pending}
        aria-label={selectId ? undefined : 'Enquiry stage'}
        onChange={(event) => {
          const form = event.currentTarget.form;
          if (form) startTransition(() => form.requestSubmit());
        }}
      >
        {Object.entries(LEAD_STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </form>
  );
}
