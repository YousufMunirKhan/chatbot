'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { humanizeToken } from '@/lib/constants';
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

/**
 * One connector action, as a chip.
 *
 * The value is the action id the connector registered (`update_stock`,
 * `create_product`), so the chip shows it humanised while the React key stays
 * the raw id — two actions can humanise to the same words, ids cannot collide.
 */
function pill(value: string) {
  return (
    <span key={value} className="rounded-full border bg-muted/40 px-2 py-1 text-xs">
      {humanizeToken(value)}
    </span>
  );
}

export function HelpdeskDocumentReview({
  doc,
  platformLabel,
}: {
  doc: HelpdeskConnectorDocumentRow;
  platformLabel: string;
}) {
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
            {/* `module` and `screen` arrive as the connector's own identifiers
                (`inventory`, `add_product`), and this heading is the first
                thing on a card the owner is asked to approve. */}
            <h2 className="font-semibold">
              {humanizeToken(doc.module)} / {humanizeToken(doc.screen)}
            </h2>
            <Badge variant="secondary">{platformLabel}</Badge>
            <Badge variant="warning">Waiting for you</Badge>
            <Badge
              variant={
                doc.changeType === 'updated'
                  ? 'warning'
                  : doc.changeType === 'new'
                    ? 'success'
                    : 'secondary'
              }
            >
              {doc.changeType === 'updated'
                ? 'Changed'
                : doc.changeType === 'new'
                  ? 'New'
                  : 'Unchanged'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {doc.path ?? 'No menu path'} - {doc.connectorName}
          </p>
          {/* The internal key and route ID are developer identifiers. They stay
              available for support, but inside the details disclosure below rather
              than on the face of a card a shop owner is asked to approve. */}
        </div>
        <div className="shrink-0">
          <div className="flex flex-wrap gap-2">
            <form action={approveConnectorDocumentAction}>
              <input type="hidden" name="documentId" value={doc.id} />
              <ReviewActionButton
                icon={<CheckCircle2 className="h-4 w-4" />}
                pendingLabel="Saving..."
              >
                Approve and save
              </ReviewActionButton>
            </form>
            <form action={handleIgnore}>
              <input type="hidden" name="documentId" value={doc.id} />
              <ReviewActionButton
                icon={<XCircle className="h-4 w-4" />}
                pendingLabel="Ignoring..."
                variant="outline"
              >
                Do not use this screen
              </ReviewActionButton>
            </form>
          </div>
          {/* The old label was just "Ignore", and the card then vanished for
              good — a one-way action reading like a dismissal. The button now
              names what is dropped, and this line says it does not come back. */}
          <p className="mt-2 max-w-xs text-xs text-muted-foreground">
            Dropping it removes this screen from the list for good, and the assistant will not
            answer questions about it.
          </p>
        </div>
      </div>

      <details className="border-t">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
          See the details, or reword the answer
        </summary>
        <div className="grid gap-4 p-4 pt-1 lg:grid-cols-[0.9fr_1.1fr] [&>*]:min-w-0">
          <div className="space-y-3 rounded-md bg-muted/30 p-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                For your developer
              </p>
              <p className="mt-2 font-mono text-xs text-muted-foreground">{doc.externalKey}</p>
              {doc.navigation?.routeId ? (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {doc.navigation.label ?? doc.screen} {'->'} {doc.navigation.routeId}
                </p>
              ) : null}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Steps
              </p>
              {doc.steps.length ? (
                <ol className="mt-2 list-decimal space-y-1 ps-4 text-sm">
                  {doc.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No steps supplied.</p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fields
              </p>
              <div className="mt-2 space-y-1">
                {doc.fields.length ? (
                  doc.fields.map((field) => (
                    <div key={field.name} className="rounded border bg-background p-2 text-xs">
                      <span className="font-medium">{field.name}</span>
                      {field.required ? (
                        <Badge variant="warning" className="ms-2">
                          Must be filled in
                        </Badge>
                      ) : null}
                      {field.description ? (
                        <p className="mt-1 text-muted-foreground">{field.description}</p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No fields supplied.</p>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Related actions
              </p>
              {doc.actions.length ? (
                <div className="mt-2 flex flex-wrap gap-2">{doc.actions.map(pill)}</div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No actions supplied. The assistant can explain this screen but not act on it.
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Common errors
              </p>
              {doc.commonErrors.length ? (
                <ul className="mt-2 list-disc space-y-1 ps-4 text-sm">
                  {doc.commonErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No common errors supplied. Add them in the answer text if staff hit the same
                  problem often.
                </p>
              )}
            </div>
          </div>

          <form action={saveAction} className="space-y-3">
            <input type="hidden" name="documentId" value={doc.id} />
            {/* All six ids are scoped to the document: several of these cards
                render on one page, and duplicate ids would point every label at
                the first card's control. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Part of your system" htmlFor={`module-${doc.id}`}>
                <Input name="module" defaultValue={doc.module} />
              </FormField>
              <FormField label="Screen name" htmlFor={`screen-${doc.id}`}>
                <Input name="screen" defaultValue={doc.screen} />
              </FormField>
            </div>
            <FormField
              label="How staff get to this screen"
              htmlFor={`path-${doc.id}`}
              hint="The menu clicks, in order. The assistant reads these out when someone asks where something is."
            >
              <Input
                name="path"
                defaultValue={doc.path ?? ''}
                placeholder="Inventory > Products > Add Product"
              />
            </FormField>
            <FormField label="What this screen is for" htmlFor={`purpose-${doc.id}`}>
              <Input name="purpose" defaultValue={doc.purpose ?? ''} />
            </FormField>
            <FormField
              label="What the assistant will tell staff"
              htmlFor={`content-${doc.id}`}
              hint="This is the answer itself. Reword it however your team actually talks about this screen."
            >
              <Textarea name="content" rows={10} defaultValue={doc.content} />
            </FormField>
            <FormField
              label="Note for your team"
              htmlFor={`reviewNote-${doc.id}`}
              hint="Optional, and only your team sees it — the assistant never says it to anyone."
            >
              <Input
                name="reviewNote"
                defaultValue={doc.reviewNote ?? ''}
                placeholder="Checked with Sara, wording agreed"
              />
            </FormField>
            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
            {state.ok ? <p className="text-sm text-emerald-600">Draft saved.</p> : null}
            <SaveButton />
          </form>
        </div>
      </details>
    </div>
  );
}
