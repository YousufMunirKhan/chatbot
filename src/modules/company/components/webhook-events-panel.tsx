'use client';

import { useFormState } from 'react-dom';
import { Badge } from '@/components/ui/badge';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { sendTestEventAction, type TestEventState } from '../developers-actions';

const initial: TestEventState = {};

export interface WebhookEventRow {
  event: string;
  label: string;
  description: string;
  subscribed: boolean;
  sample: Record<string, unknown>;
}

/**
 * One form per row, each with its own `useFormState`, so the result of a test
 * send lands next to the event it belongs to instead of in one shared banner
 * where the user has to remember which button they pressed.
 */
function TestEventForm({ event }: { event: string }) {
  const [state, action] = useFormState(sendTestEventAction, initial);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="event" value={event} />
      <SubmitButton size="sm" variant="outline" pendingLabel="Sending…">
        Send test
      </SubmitButton>
      {state.error || state.message ? (
        <span
          role={state.error ? 'alert' : 'status'}
          aria-live={state.error ? undefined : 'polite'}
          className={`text-xs ${state.error ? 'text-danger-fg' : 'text-success-fg'}`}
        >
          {state.error ?? state.message}
        </span>
      ) : null}
    </form>
  );
}

export function WebhookEventsPanel({ events }: { events: WebhookEventRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>What it means</TableHead>
          <TableHead>Sample payload</TableHead>
          <TableHead className="text-end">Test</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((row) => (
          <TableRow key={row.event}>
            <TableCell className="align-top">
              <code className="font-mono text-xs">{row.event}</code>
              <div className="mt-1">
                {row.subscribed ? (
                  <Badge variant="success">Subscribed</Badge>
                ) : (
                  <Badge variant="outline">Not subscribed</Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="align-top">
              <div className="font-medium">{row.label}</div>
              <p className="text-xs text-muted-foreground">{row.description}</p>
            </TableCell>
            <TableCell className="align-top">
              <pre className="max-w-xs overflow-x-auto rounded bg-muted p-2 text-[11px] leading-relaxed">
                {JSON.stringify(row.sample, null, 2)}
              </pre>
            </TableCell>
            <TableCell className="text-end align-top">
              <TestEventForm event={row.event} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
