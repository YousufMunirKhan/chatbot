'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { reportHelpdeskIssueAction } from '../helpdesk-actions';
import type { ActionState } from '../actions';

const initial: ActionState = {};
const TEMPLATES = [
  {
    label: 'Report not loading',
    subject: 'Report is not loading',
    severity: 'high',
    route: 'reports.daily_sales',
    details:
      'Staff tried to open or generate a report, but the result stayed queued or did not appear. Please check connector delivery, report action logs, and POS report API response.',
  },
  {
    label: 'Stock mismatch',
    subject: 'Stock quantity does not match POS',
    severity: 'normal',
    route: 'inventory.products',
    details:
      'Staff found a stock value that does not match the POS. Please check the product identifier, latest sync time, and stock lookup/update action response.',
  },
  {
    label: 'Product update failed',
    subject: 'Product update failed',
    severity: 'high',
    route: 'inventory.products',
    details:
      'Staff attempted to update a product, but the connector action failed or did not confirm the update. Please check required fields, confirmation status, and POS validation errors.',
  },
  {
    label: 'Connector offline',
    subject: 'Connector is offline',
    severity: 'urgent',
    route: 'helpdesk.connector',
    details:
      'The connector is not polling or sending results. Please check the connector token, base URL, internet access, and whether the connector service/app is running.',
  },
] as const;

export function HelpdeskIssueReportForm() {
  const [state, action] = useFormState(reportHelpdeskIssueAction, initial);
  const [subject, setSubject] = useState('');
  const [severity, setSeverity] = useState('normal');
  const [route, setRoute] = useState('');
  const [details, setDetails] = useState('');

  function applyTemplate(template: (typeof TEMPLATES)[number]) {
    setSubject(template.subject);
    setSeverity(template.severity);
    setRoute(template.route);
    setDetails(template.details);
  }

  return (
    <form action={action} className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TEMPLATES.map((template) => (
          <Button
            key={template.label}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => applyTemplate(template)}
          >
            {template.label}
          </Button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
        <FormField label="Issue summary" htmlFor="helpdesk-issue-subject">
          <Input
            name="subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Example: Daily sales report stays queued"
            required
          />
        </FormField>
        <FormField label="Severity" htmlFor="helpdesk-issue-severity">
          <Select
            name="severity"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </FormField>
      </div>
      <FormField label="Screen or route" htmlFor="helpdesk-issue-route">
        <Input
          name="currentRoute"
          value={route}
          onChange={(event) => setRoute(event.target.value)}
          placeholder="Example: reports.daily_sales or /company/help-desk?tab=ask"
        />
      </FormField>
      <FormField label="What happened?" htmlFor="helpdesk-issue-details">
        {/* `min-h-0 p-3` keeps this 5-row box exactly as it was while still
            taking `Textarea`'s shared border, background and focus ring. */}
        <Textarea
          name="details"
          rows={5}
          className="min-h-0 p-3"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          placeholder="Write what the staff member tried, what they expected, and what error or result they saw."
          required
        />
      </FormField>
      <FormMessage state={{ error: state.error }} />
      {state.ok ? (
        // The confirmation is a tinted panel rather than a bare line, so it
        // stays an `Alert` — with the live region added by hand, which the
        // `bg-emerald-50` paragraph it replaces never had.
        <Alert tone="success" role="status" aria-live="polite" className="p-3">
          Issue report sent. It is now visible in company notifications and delivery rules will fan
          it out if enabled.
        </Alert>
      ) : null}
      <SubmitButton pendingLabel="Sending...">Send issue report</SubmitButton>
    </form>
  );
}
