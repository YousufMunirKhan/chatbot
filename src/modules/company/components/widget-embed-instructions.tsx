import Link from 'next/link';
import { CopyButton } from '@/components/copy-button';
import { SectionHeader } from '@/components/ui/section-header';

export function WidgetEmbedInstructions({
  embed,
  domainAllowlist,
  settingsHref,
}: {
  embed: string;
  domainAllowlist: string[];
  settingsHref: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        {/* Was `<p className="mb-2 text-sm font-medium">` — a paragraph dressed
            as a heading, so this block had no entry in the document outline at
            all. `SectionHeader` at `size="eyebrow"` is the same small quiet
            treatment and a real `<h3>`; level 3 because the card title above it
            owns the `<h2>`. */}
        <SectionHeader className="mb-2" level={3} size="eyebrow" title="Embed on your website" />
        {/* `overflow-auto` gives a code block BOTH scrollbars; a one-line
            snippet only ever needs the horizontal one, and the vertical one
            appeared as a stray 15px gutter. */}
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{embed}</pre>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <CopyButton value={embed} label="Copy snippet" />
          <span className="text-xs text-muted-foreground">
            Add it once on every page where the chat widget should appear.
          </span>
        </div>
      </div>

      {/* `sm:grid-cols-2` is a VIEWPORT query, and this component has two
          homes: the `max-w-3xl` bot settings page, and the design studio's
          embed panel, which sits in an `xl:grid-cols-[minmax(360px,440px)_1fr]`
          split. In the second one, at 640px and up, the rule fired and gave
          each of these four paragraphs about 180px — "Normal HTML / PHP
          website" broke onto three lines above a description one word wide.
          A floor asks the panel instead. */}
      <div className="grid gap-3 text-sm [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
        <div className="rounded-md border p-3">
          <p className="font-medium">Normal HTML / PHP website</p>
          <p className="mt-1 text-muted-foreground">
            Paste the snippet near the bottom of the page, just before <code>&lt;/body&gt;</code>.
            For all pages, add it in the shared footer/template file.
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="font-medium">WordPress</p>
          <p className="mt-1 text-muted-foreground">
            Add it through a header/footer scripts plugin, or paste it in the theme footer before
            <code>&lt;/body&gt;</code>. Clear cache after saving.
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="font-medium">Shopify</p>
          <p className="mt-1 text-muted-foreground">
            Go to Online Store, Themes, Edit code, open <code>theme.liquid</code>, then paste before
            <code>&lt;/body&gt;</code>.
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="font-medium">React / Next.js / custom app</p>
          <p className="mt-1 text-muted-foreground">
            Add the script in the global layout/footer so it loads on every customer-facing page.
            Keep it out of admin/private pages.
          </p>
        </div>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <p className="font-medium">Allowed domains</p>
        <p className="mt-1 text-muted-foreground">
          {domainAllowlist.length
            ? domainAllowlist.join(', ')
            : 'No domain restriction is set yet. Add the real website domain before launch so other sites cannot use this widget ID.'}
        </p>
        {domainAllowlist.length === 0 ? (
          <Link href={settingsHref} className="mt-2 inline-block text-primary hover:underline">
            Add allowed domain
          </Link>
        ) : null}
      </div>
    </div>
  );
}
