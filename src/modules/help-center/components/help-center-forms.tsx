'use client';

import * as React from 'react';
import { useFormState } from 'react-dom';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { ArticleBody, summarize } from '../markdown';
import { slugify } from '../slug';
import {
  createHelpArticleAction,
  createHelpCategoryAction,
  deleteHelpArticleAction,
  deleteHelpCategoryAction,
  moveHelpArticleAction,
  moveHelpCategoryAction,
  publishHelpArticleAction,
  reindexHelpArticleAction,
  saveHelpArticleAction,
  saveHelpCenterSettingsAction,
  unpublishHelpArticleAction,
  updateHelpCategoryAction,
  type ActionState,
} from '../help-center-actions';

/**
 * Every form on the help-centre screens, in one client module.
 *
 * They are `useFormState` (React 18) over server actions, which is this
 * project's convention — `useActionState` is React 19 and this repository is on
 * 18.3. One hydration boundary for the lot is cheaper than eight, and it keeps
 * the pages themselves server components.
 *
 * These import the actions directly, which is exactly why the actions do their
 * own `requireRole` check: an agent who never sees the Publish button can still
 * reach `publishHelpArticleAction` through this module's bundle.
 */

const initial: ActionState = {};

function useResettingForm(state: ActionState) {
  const ref = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

// ---------------------------------------------------------------------------
// The public surface
// ---------------------------------------------------------------------------

export function HelpCenterSettingsForm({
  slug,
  title,
  description,
  isPublished,
  origin,
}: {
  slug: string | null;
  title: string;
  description: string;
  isPublished: boolean;
  /** e.g. `https://app.example.com` — shown before the address box. */
  origin: string;
}) {
  const [state, action] = useFormState(saveHelpCenterSettingsAction, initial);
  const [handle, setHandle] = React.useState(slug ?? '');

  return (
    <form action={action} className="space-y-4">
      <FormField
        label="Web address"
        htmlFor="help-center-slug"
        hint={
          handle
            ? `Your help centre will live at ${origin}/help/${handle}`
            : 'Leave this blank and the long assistant id is used instead. A short address is easier to share and better for search engines.'
        }
      >
        <Input
          name="slug"
          value={handle}
          onChange={(event) => setHandle(slugify(event.target.value))}
          placeholder="acme-support"
          autoComplete="off"
        />
      </FormField>

      <FormField
        label="Title"
        htmlFor="help-center-title"
        required
        hint="The heading readers see, and the page title in search results."
      >
        <Input name="title" defaultValue={title} required maxLength={120} />
      </FormField>

      <FormField
        label="Description"
        htmlFor="help-center-description"
        hint="One sentence. Search engines show roughly the first 160 characters underneath your link."
      >
        <Textarea name="description" defaultValue={description} rows={2} maxLength={320} />
      </FormField>

      <div className="flex items-start gap-2">
        <input
          id="help-center-published"
          name="isPublished"
          type="checkbox"
          defaultChecked={isPublished}
          className="mt-0.5 h-4 w-4 rounded border-input"
        />
        <div className="space-y-0.5">
          <Label htmlFor="help-center-published">Visible to the public</Label>
          <p className="text-xs text-muted-foreground">
            Turn this off and the public pages return “not found”. Your articles and drafts are kept.
          </p>
        </div>
      </div>

      <FormMessage state={state} okText="Saved." />
      <SubmitButton size="sm" pendingLabel="Saving…">
        Save
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export function NewCategoryForm() {
  const [state, action] = useFormState(createHelpCategoryAction, initial);
  const ref = useResettingForm(state);

  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
      <FormField
        label="New section"
        htmlFor="help-category-name"
        hint="A heading readers browse by — Billing, Delivery, Returns."
        className="min-w-[14rem] flex-1"
      >
        <Input name="name" required maxLength={120} placeholder="Returns" />
      </FormField>
      <SubmitButton size="sm" variant="outline" pendingLabel="Adding…">
        Add section
      </SubmitButton>
      <FormMessage state={state} okText="Section added." className="basis-full" />
    </form>
  );
}

export function CategoryRow({
  id,
  name,
  description,
  isFirst,
  isLast,
  articleCount,
}: {
  id: string;
  name: string;
  description: string | null;
  isFirst: boolean;
  isLast: boolean;
  articleCount: number;
}) {
  const [state, action] = useFormState(updateHelpCategoryAction, initial);

  return (
    <div className="space-y-2 rounded-md border p-4">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="categoryId" value={id} />
        <FormField label="Name" htmlFor={`category-name-${id}`} className="min-w-[12rem] flex-1">
          <Input name="name" defaultValue={name} required maxLength={120} />
        </FormField>
        <FormField
          label="Description"
          htmlFor={`category-description-${id}`}
          className="min-w-[16rem] flex-[2]"
        >
          <Input name="description" defaultValue={description ?? ''} maxLength={400} />
        </FormField>
        <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
          Save
        </SubmitButton>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <MoveButtons action={moveHelpCategoryAction} id={id} isFirst={isFirst} isLast={isLast} />
        <span className="text-xs text-muted-foreground">
          {articleCount === 1 ? '1 article' : `${articleCount} articles`}
        </span>
        <div className="ms-auto">
          <DeleteCategoryButton id={id} articleCount={articleCount} />
        </div>
      </div>

      <FormMessage state={state} okText="Saved." />
    </div>
  );
}

function DeleteCategoryButton({ id, articleCount }: { id: string; articleCount: number }) {
  const [state, action] = useFormState(deleteHelpCategoryAction, initial);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="categoryId" value={id} />
      <ConfirmSubmit
        label="Delete section"
        confirmLabel="Delete it"
        question={
          articleCount > 0
            ? `The ${articleCount === 1 ? 'article' : `${articleCount} articles`} inside stay published, without a section.`
            : 'This cannot be undone.'
        }
      />
      <FormMessage state={state} okText="Deleted." />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * Up/down instead of drag-and-drop. Two buttons work with a keyboard, with a
 * screen reader and on a phone, and the lists here are short enough that the
 * fancier control would buy nothing.
 */
export function MoveButtons({
  action,
  id,
  isFirst,
  isLast,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  id: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [, formAction] = useFormState(action, initial);
  if (isFirst && isLast) return null;

  // Two forms, each carrying its direction in a hidden field, rather than one
  // form with two named submit buttons. Whether a submitter's own name/value
  // reaches a server action's FormData is a detail of the React and Next
  // versions in use; a hidden input is what every version sends.
  return (
    <div className="flex items-center gap-1">
      {(['up', 'down'] as const).map((direction) => (
        <form key={direction} action={formAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="direction" value={direction} />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            disabled={direction === 'up' ? isFirst : isLast}
            aria-label={direction === 'up' ? 'Move up' : 'Move down'}
          >
            <span aria-hidden="true">{direction === 'up' ? '↑' : '↓'}</span>
          </Button>
        </form>
      ))}
    </div>
  );
}

export function ArticleMoveButtons({
  id,
  isFirst,
  isLast,
}: {
  id: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  return <MoveButtons action={moveHelpArticleAction} id={id} isFirst={isFirst} isLast={isLast} />;
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

export function NewArticleForm({ categories }: { categories: Array<{ id: string; name: string }> }) {
  const [state, action] = useFormState(createHelpArticleAction, initial);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <FormField
        label="New article"
        htmlFor="new-article-title"
        hint="It opens as a draft. Nothing is public until you publish it."
        className="min-w-[16rem] flex-1"
      >
        <Input name="title" required maxLength={200} placeholder="How do I return an item?" />
      </FormField>
      {categories.length > 0 ? (
        <FormField label="Section" htmlFor="new-article-category">
          <Select name="categoryId" defaultValue="" className="w-auto">
            <option value="">No section</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      <SubmitButton size="sm" pendingLabel="Creating…">
        Write article
      </SubmitButton>
      <FormMessage state={state} className="basis-full" />
    </form>
  );
}

/**
 * The editor.
 *
 * The preview renders through the SAME `ArticleBody` the public page uses, so
 * what the writer approves is what the reader gets — a preview built from a
 * second renderer is a preview that eventually lies.
 */
export function ArticleEditorForm({
  articleId,
  title,
  slug,
  excerpt,
  body,
  categoryId,
  seoTitle,
  seoDescription,
  categories,
  origin,
  handle,
}: {
  articleId: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  categoryId: string | null;
  seoTitle: string;
  seoDescription: string;
  categories: Array<{ id: string; name: string }>;
  origin: string;
  handle: string | null;
}) {
  const [state, action] = useFormState(saveHelpArticleAction, initial);
  const [draftBody, setDraftBody] = React.useState(body);
  const [draftSlug, setDraftSlug] = React.useState(slug);
  const [draftTitle, setDraftTitle] = React.useState(title);
  const [draftExcerpt, setDraftExcerpt] = React.useState(excerpt);
  const [showPreview, setShowPreview] = React.useState(false);

  const metaTitle = seoTitle || draftTitle;
  const metaDescription = seoDescription || draftExcerpt || summarize(draftBody, 160);
  const url = handle ? `${origin}/help/${handle}/${draftSlug || 'your-article'}` : null;

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="articleId" value={articleId} />

      <div className="grid gap-4 lg:grid-cols-3">
        <FormField label="Title" htmlFor="article-title" required className="lg:col-span-2">
          <Input
            name="title"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            required
            maxLength={200}
          />
        </FormField>
        <FormField label="Section" htmlFor="article-category">
          <Select name="categoryId" defaultValue={categoryId ?? ''}>
            <option value="">No section</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <FormField
        label="Web address"
        htmlFor="article-slug"
        hint={
          url
            ? `Readers will find it at ${url}. Changing this breaks links you have already shared.`
            : 'Lowercase letters, numbers and hyphens.'
        }
      >
        <Input
          name="slug"
          value={draftSlug}
          onChange={(event) => setDraftSlug(slugify(event.target.value))}
          autoComplete="off"
        />
      </FormField>

      <FormField
        label="Summary"
        htmlFor="article-excerpt"
        hint="One line, shown under the title in lists and in search results. Left blank, the opening of the article is used."
      >
        <Textarea
          name="excerpt"
          value={draftExcerpt}
          onChange={(event) => setDraftExcerpt(event.target.value)}
          rows={2}
          maxLength={400}
        />
      </FormField>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="article-body">Article</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview((v) => !v)}
            aria-pressed={showPreview}
          >
            {showPreview ? 'Back to writing' : 'Preview'}
          </Button>
        </div>

        {showPreview ? (
          <div className="rounded-md border bg-card p-6">
            <h2 className="text-2xl font-semibold">{draftTitle || 'Untitled'}</h2>
            {draftExcerpt ? <p className="mt-1 text-sm text-muted-foreground">{draftExcerpt}</p> : null}
            <div className="mt-4">
              <ArticleBody source={draftBody} />
            </div>
          </div>
        ) : (
          <Textarea
            id="article-body"
            name="body"
            value={draftBody}
            onChange={(event) => setDraftBody(event.target.value)}
            rows={20}
            className="font-mono text-[13px]"
            placeholder={'## Returning an item\n\n1. Open your order confirmation email\n2. Click **Start a return**\n\nRefunds land within 5 working days.'}
          />
        )}

        {/* The textarea is unmounted while previewing, and an unmounted control
            submits nothing — so the body rides along in a hidden field and the
            writer cannot lose their work by saving from the preview. */}
        {showPreview ? <input type="hidden" name="body" value={draftBody} /> : null}

        <p className="text-xs text-muted-foreground">
          Markdown: <code># heading</code>, <code>- list</code>, <code>**bold**</code>,{' '}
          <code>[link](https://…)</code>.
        </p>
      </div>

      <details className="rounded-md border p-4">
        <summary className="cursor-pointer text-sm font-medium">Search engine listing</summary>
        <div className="mt-4 space-y-4">
          <div className="rounded-md bg-muted p-3">
            <p className="truncate text-sm text-info-fg">{metaTitle || 'Untitled'}</p>
            {url ? <p className="truncate text-xs text-success-fg">{url}</p> : null}
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {metaDescription || 'No description yet.'}
            </p>
          </div>
          <FormField
            label="Page title"
            htmlFor="article-seo-title"
            hint="Only if the title in search results should differ from the heading."
          >
            <Input name="seoTitle" defaultValue={seoTitle} maxLength={200} placeholder={draftTitle} />
          </FormField>
          <FormField
            label="Meta description"
            htmlFor="article-seo-description"
            hint="Around 160 characters. Left blank, the summary above is used."
          >
            <Textarea name="seoDescription" defaultValue={seoDescription} rows={2} maxLength={320} />
          </FormField>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        <FormMessage state={state} okText="Saved." />
      </div>
    </form>
  );
}

/**
 * Publish, withdraw, re-index, delete.
 *
 * Separate forms from the editor on purpose: publishing has to act on what is
 * stored, not on what is sitting unsaved in a textarea, and one form cannot
 * post to four actions anyway.
 */
export function ArticleStateControls({
  articleId,
  status,
  indexed,
  canPublish,
}: {
  articleId: string;
  status: 'draft' | 'published';
  indexed: boolean;
  /** False for agents — they write, an admin publishes. */
  canPublish: boolean;
}) {
  const [publishState, publish] = useFormState(publishHelpArticleAction, initial);
  const [unpublishState, unpublish] = useFormState(unpublishHelpArticleAction, initial);
  const [reindexState, reindex] = useFormState(reindexHelpArticleAction, initial);
  const [deleteState, remove] = useFormState(deleteHelpArticleAction, initial);

  return (
    <div className="space-y-3">
      {canPublish ? (
        status === 'published' ? (
          <form action={unpublish} className="space-y-2">
            <input type="hidden" name="articleId" value={articleId} />
            <SubmitButton variant="outline" size="sm" pendingLabel="Withdrawing…">
              Unpublish
            </SubmitButton>
            <p className="text-xs text-muted-foreground">
              Takes the page down and stops the assistant quoting it. The article stays here as a draft.
            </p>
            <FormMessage state={unpublishState} okText="Withdrawn." />
          </form>
        ) : (
          <form action={publish} className="space-y-2">
            <input type="hidden" name="articleId" value={articleId} />
            <SubmitButton size="sm" pendingLabel="Publishing…">
              Publish
            </SubmitButton>
            <p className="text-xs text-muted-foreground">
              Puts it on your public help centre and teaches it to the assistant.
            </p>
            <FormMessage state={publishState} okText="Published." />
          </form>
        )
      ) : (
        <p className="text-xs text-muted-foreground">
          Save your changes and ask an administrator to publish.
        </p>
      )}

      {status === 'published' ? (
        <form action={reindex} className="space-y-2 border-t pt-3">
          <SubmitButton variant="outline" size="sm" pendingLabel="Updating…">
            Update the assistant
          </SubmitButton>
          <input type="hidden" name="articleId" value={articleId} />
          <p className="text-xs text-muted-foreground">
            {indexed
              ? 'The assistant already answers from this article. Use this after an edit if it seems out of date.'
              : 'The assistant does not have this article yet.'}
          </p>
          <FormMessage state={reindexState} okText="The assistant has it." />
        </form>
      ) : null}

      {canPublish ? (
        <form action={remove} className="space-y-2 border-t pt-3">
          <input type="hidden" name="articleId" value={articleId} />
          <ConfirmSubmit label="Delete article" confirmLabel="Delete it" />
          <FormMessage state={deleteState} />
        </form>
      ) : null}
    </div>
  );
}
