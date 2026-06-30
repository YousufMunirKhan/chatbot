'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { HelpdeskConnectorDocumentRow } from '../helpdesk-data';
import {
  approveConnectorDocumentAction,
  rejectConnectorDocumentAction,
  saveConnectorDocumentDraftAction,
} from '../helpdesk-actions';
import type { ActionState } from '../actions';

const initial: ActionState = {};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? 'Saving...' : 'Save edits'}
    </Button>
  );
}

function ReviewActionButton({
  children,
  icon,
  pendingLabel,
  variant = 'default',
}: {
  children: ReactNode;
  icon: ReactNode;
  pendingLabel: string;
  variant?: 'default' | 'outline';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} className="gap-2" disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {pending ? pendingLabel : children}
    </Button>
  );
}

function pill(value: string) {
  return (
    <span key={value} className="rounded-full border bg-muted/40 px-2 py-1 text-xs">
      {value}
    </span>
  );
}

export function HelpdeskDocumentReview({ doc, platformLabel }: { doc: HelpdeskConnectorDocumentRow; platformLabel: string }) {
  const [state, saveAction] = useFormState(saveConnectorDocumentDraftAction, initial);
  const [isIgnored, setIsIgnored] = useState(false);

  async function handleIgnore(formData: FormData) {
    setIsIgnored(true);
    try {
      await rejectConnectorDocumentAction(formData);
    } catch (error) {
      setIsIgnored(false);
      throw error;
    }
  }

  if (isIgnored) return null;

  return (
    <div className="rounded-md border bg-background">
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{doc.module} / {doc.screen}</h2>
            <Badge variant="secondary">{platformLabel}</Badge>
            <Badge variant="warning">Draft</Badge>
            <Badge variant={doc.changeType === 'updated' ? 'warning' : doc.changeType === 'new' ? 'success' : 'secondary'}>
              {doc.changeType}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {doc.path ?? 'No menu path'} - {doc.connectorName}
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">Key: {doc.externalKey}</p>
          {doc.navigation?.routeId ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Navigation: {doc.navigation.label ?? doc.screen} {'->'} {doc.navigation.routeId}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={approveConnectorDocumentAction}>
            <input type="hidden" name="documentId" value={doc.id} />
            <ReviewActionButton icon={<CheckCircle2 className="h-4 w-4" />} pendingLabel="Indexing...">
              Approve and index
            </ReviewActionButton>
          </form>
          <form action={handleIgnore}>
            <input type="hidden" name="documentId" value={doc.id} />
            <ReviewActionButton icon={<XCircle className="h-4 w-4" />} pendingLabel="Ignoring..." variant="outline">
              Ignore
            </ReviewActionButton>
          </form>
        </div>
      </div>

      <details className="border-t">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
          Review details and edit answer text
        </summary>
        <div className="grid gap-4 p-4 pt-1 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-3 rounded-md bg-muted/30 p-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Steps</p>
              {doc.steps.length ? (
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm">
                  {doc.steps.map((step) => <li key={step}>{step}</li>)}
                </ol>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No steps supplied.</p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fields</p>
              <div className="mt-2 space-y-1">
                {doc.fields.length ? (
                  doc.fields.map((field) => (
                    <div key={field.name} className="rounded border bg-background p-2 text-xs">
                      <span className="font-medium">{field.name}</span>
                      {field.required ? <Badge variant="warning" className="ml-2">required</Badge> : null}
                      {field.description ? <p className="mt-1 text-muted-foreground">{field.description}</p> : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No fields supplied.</p>
                )}
              </div>
            </div>
            {doc.actions.length ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Related actions</p>
                <div className="mt-2 flex flex-wrap gap-2">{doc.actions.map(pill)}</div>
              </div>
            ) : null}
            {doc.commonErrors.length ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Common errors</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                  {doc.commonErrors.map((error) => <li key={error}>{error}</li>)}
                </ul>
              </div>
            ) : null}
          </div>

          <form action={saveAction} className="space-y-3">
            <input type="hidden" name="documentId" value={doc.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Module</Label>
                <Input name="module" defaultValue={doc.module} />
              </div>
              <div className="space-y-1.5">
                <Label>Screen</Label>
                <Input name="screen" defaultValue={doc.screen} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Clickable path / menu path</Label>
              <Input name="path" defaultValue={doc.path ?? ''} placeholder="Inventory > Products > Add Product" />
            </div>
            <div className="space-y-1.5">
              <Label>Purpose</Label>
              <Input name="purpose" defaultValue={doc.purpose ?? ''} />
            </div>
            <div className="space-y-1.5">
              <Label>Answer text used by Help Desk</Label>
              <Textarea name="content" rows={10} defaultValue={doc.content} />
            </div>
            <div className="space-y-1.5">
              <Label>Review note</Label>
              <Input name="reviewNote" defaultValue={doc.reviewNote ?? ''} placeholder="Optional note for your team" />
            </div>
            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
            {state.ok ? <p className="text-sm text-emerald-600">Draft saved.</p> : null}
            <SaveButton />
          </form>
        </div>
      </details>
    </div>
  );
}
