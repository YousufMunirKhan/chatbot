import { signAttachmentById } from '@/lib/attachments/store';
import { formatBytes, type AttachmentDescriptor } from '@/lib/attachments/policy';
import { getCompanyId } from '../data';

/**
 * One attachment inside a transcript bubble.
 *
 * A server component, and async, because the URL cannot be rendered ahead of
 * time: the bucket is private, so every view mints a signed URL that dies
 * fifteen minutes later. Handing a stored URL to the browser would mean either
 * publishing the file or shipping a link that is already dead — signing at
 * render is what makes a private bucket usable on a page.
 *
 * It resolves the company id itself rather than taking one as a prop. That is
 * the point: `getCompanyId()` reads the SESSION, so an attachment id that
 * belongs to another tenant finds no row and renders as unavailable, no matter
 * what the caller passed in. There is no prop here that could carry a wrong
 * company across.
 */
export async function MessageAttachment({ attachment }: { attachment: AttachmentDescriptor }) {
  const companyId = await getCompanyId();
  const signed = await signAttachmentById({ companyId, attachmentId: attachment.id });

  if (!signed) {
    return (
      <p className="mt-1.5 text-xs text-muted-foreground">
        {attachment.name} — this file is no longer available.
      </p>
    );
  }

  if (signed.kind === 'image') {
    return (
      <a
        href={signed.url}
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 block w-fit overflow-hidden rounded-md border bg-background"
        title={`${signed.name} · ${formatBytes(signed.size)}`}
      >
        {/*
          A plain <img>, not next/image. The signed host is not in the image
          config, the URL changes on every render so nothing could be cached
          against it anyway, and the optimizer would fetch a private object
          through our own server for no gain.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={signed.url}
          alt={signed.name}
          className="max-h-64 max-w-full object-contain"
          loading="lazy"
        />
      </a>
    );
  }

  return (
    <a
      href={signed.url}
      target="_blank"
      rel="noreferrer"
      className="mt-1.5 flex w-fit max-w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent"
    >
      <span aria-hidden="true">📎</span>
      <span className="truncate font-medium">{signed.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(signed.size)}</span>
    </a>
  );
}
