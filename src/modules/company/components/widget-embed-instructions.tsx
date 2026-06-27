import Link from 'next/link';
import { CopyButton } from '@/components/copy-button';

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
        <p className="mb-2 text-sm font-medium">Embed on your website</p>
        <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{embed}</pre>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <CopyButton value={embed} label="Copy snippet" />
          <span className="text-xs text-muted-foreground">
            Add it once on every page where the chat widget should appear.
          </span>
        </div>
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-2">
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
