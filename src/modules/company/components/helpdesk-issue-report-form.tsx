'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { reportHelpdeskIssueAction } from '../helpdesk-actions';
import type { ActionState } from '../actions';

const initial: ActionState = {};
const TEMPLATES = [
  {
    label: 'Report not loading',
    subject: 'Report is not loading',
    severity: 'high',
    route: 'reports.daily_sales',
    details: 'Staff tried to open or generate a report, but the result stayed queued or did not appear. Please check connector delivery, report action logs, and POS report API response.',
  },
  {
    label: 'Stock mismatch',
    subject: 'Stock quantity does not match POS',
    severity: 'normal',
    route: 'inventory.products',
    details: 'Staff found a stock value that does not match the POS. Please check the product identifier, latest sync time, and stock lookup/update action response.',
  },
  {
    label: 'Product update failed',
    subject: 'Product update failed',
    severity: 'high',
    route: 'inventory.products',
    details: 'Staff attempted to update a product, but the connector action failed or did not confirm the update. Please check required fields, confirmation status, and POS validation errors.',
  },
  {
    label: 'Connector offline',
    subject: 'Connector is offline',
    severity: 'urgent',
    route: 'helpdesk.connector',
    details: 'The connector is not polling or sending results. Please check the connector token, base URL, internet access, and whether the connector service/app is running.',
  },
] as const;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Sending...' : 'Send issue report'}
    </Button>
  );
}

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
      <div className="grid gap-4 md:grid-cols-[1fr_180px]">
        <div className="space-y-1.5">
          <Label htmlFor="helpdesk-issue-subject">Issue summary</Label>
          <Input
            id="helpdesk-issue-subject"
            name="subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Example: Daily sales report stays queued"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="helpdesk-issue-severity">Severity</Label>
          <select
            id="helpdesk-issue-severity"
            name="severity"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="helpdesk-issue-route">Screen or route</Label>
        <Input
          id="helpdesk-issue-route"
          name="currentRoute"
          value={route}
          onChange={(event) => setRoute(event.target.value)}
          placeholder="Example: reports.daily_sales or /company/help-desk?tab=ask"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="helpdesk-issue-details">What happened?</Label>
        <textarea
          id="helpdesk-issue-details"
          name="details"
          rows={5}
          className="w-full rounded-md border bg-background p-3 text-sm"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          placeholder="Write what the staff member tried, what they expected, and what error or result they saw."
          required
        />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
          Issue report sent. It is now visible in company notifications and delivery rules will fan it out if enabled.
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
