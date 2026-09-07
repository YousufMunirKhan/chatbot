import * as React from 'react';
import { slugify } from './slug';

/**
 * The small subset of Markdown a help article is allowed to use.
 *
 * WHY NOT A LIBRARY
 * This repository has no Markdown dependency and adding one to render text a
 * customer's staff typed would mean shipping a parser AND a sanitiser to the
 * public pages. Everything below returns React elements — never
 * `dangerouslySetInnerHTML` — so there is no HTML string for anybody to inject
 * into. A `<script>` somebody pastes into the body arrives at the reader as the
 * literal characters `<script>`, because React escapes text children.
 *
 * The same module renders the public page and the editor's live preview, which
 * is the point: the writer sees exactly what the reader will get, from one
 * implementation. It has no server imports, so a client component can hold it.
 *
 * Supported: `#`–`######` headings, `-`/`*`/`1.` lists, `>` quotes, ``` fences,
 * `---` rules, `**bold**`, `*italic*`, `` `code` `` and `[text](link)`.
 */

/** Links we will render as links. Everything else is shown as its own text. */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:[^\s]+@[^\s]+$/i.test(trimmed)) return trimmed;
  // A same-site path — used for linking one article to another.
  if (/^\/[^/\\]/.test(trimmed)) return trimmed;
  return null;
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;

/** Bold, italic, code and links inside one line of text. */
function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(INLINE).filter((piece) => piece !== '' && piece !== undefined);
  return parts.map((piece, i) => {
    const key = `${keyPrefix}-${i}`;
    if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) {
      return <strong key={key}>{piece.slice(2, -2)}</strong>;
    }
    if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) {
      return (
        <code key={key} className="rounded bg-black/5 px-1 py-0.5 text-[0.9em] dark:bg-white/10">
          {piece.slice(1, -1)}
        </code>
      );
    }
    if (
      (piece.startsWith('*') && piece.endsWith('*') && piece.length > 2) ||
      (piece.startsWith('_') && piece.endsWith('_') && piece.length > 2)
    ) {
      return <em key={key}>{piece.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(piece);
    if (link) {
      const href = safeHref(link[2] ?? '');
      if (!href) return <React.Fragment key={key}>{link[1]}</React.Fragment>;
      const external = /^https?:/i.test(href);
      return (
        <a
          key={key}
          href={href}
          className="underline underline-offset-2"
          {...(external ? { rel: 'nofollow noopener', target: '_blank' } : {})}
        >
          {link[1]}
        </a>
      );
    }
    return <React.Fragment key={key}>{piece}</React.Fragment>;
  });
}

type Block =
  | { kind: 'heading'; level: 2 | 3 | 4; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

/**
 * Line-by-line, because the input is a textarea and the shapes are few. Heading
 * levels are clamped to h2–h4: the page's `<h1>` is the article title, and an
 * article that opened with a second h1 would give the page two, which is the
 * one heading mistake search engines actually notice.
 */
function parse(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    if (trimmed === '') {
      flushParagraph();
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const depth = (heading[1] ?? '#').length;
      blocks.push({
        kind: 'heading',
        level: depth <= 1 ? 2 : depth === 2 ? 2 : depth === 3 ? 3 : 4,
        text: heading[2] ?? '',
      });
      continue;
    }

    if (trimmed.startsWith('> ')) {
      flushParagraph();
      blocks.push({ kind: 'quote', text: trimmed.slice(2) });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const last = blocks[blocks.length - 1];
      const item = (bullet?.[1] ?? numbered?.[1] ?? '').trim();
      if (last && last.kind === 'list' && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: 'list', ordered, items: [item] });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
}

export function ArticleBody({ source }: { source: string }) {
  const blocks = parse(source);
  if (blocks.length === 0) {
    return <p className="text-sm text-muted-foreground">This article has no content yet.</p>;
  }

  return (
    <div className="space-y-4 text-[15px] leading-relaxed">
      {blocks.map((block, i) => {
        const key = `b-${i}`;
        switch (block.kind) {
          case 'heading': {
            // An id per heading so a support agent can link a customer straight
            // to the step they are stuck on.
            const id = slugify(block.text) || undefined;
            const className =
              block.level === 2
                ? 'pt-2 text-lg font-semibold'
                : block.level === 3
                  ? 'pt-1 text-base font-semibold'
                  : 'text-sm font-semibold';
            const Tag = (block.level === 2 ? 'h2' : block.level === 3 ? 'h3' : 'h4') as 'h2';
            return (
              <Tag key={key} id={id} className={className}>
                {inline(block.text, key)}
              </Tag>
            );
          }
          case 'list':
            return block.ordered ? (
              <ol key={key} className="list-decimal space-y-1 ps-6">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{inline(item, `${key}-${j}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={key} className="list-disc space-y-1 ps-6">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{inline(item, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case 'quote':
            return (
              <blockquote key={key} className="border-s-4 border-black/10 ps-4 italic dark:border-white/20">
                {inline(block.text, key)}
              </blockquote>
            );
          case 'code':
            return (
              <pre key={key} className="overflow-x-auto rounded-md bg-black/5 p-3 text-[13px] dark:bg-white/10">
                <code>{block.text}</code>
              </pre>
            );
          case 'rule':
            return <hr key={key} className="border-black/10 dark:border-white/20" />;
          default:
            return <p key={key}>{inline(block.text, key)}</p>;
        }
      })}
    </div>
  );
}

/**
 * The article as plain prose: what the meta description falls back to, what the
 * list excerpt is cut from, and what gets embedded for the assistant. Markup
 * characters would otherwise end up inside a `<meta>` tag and inside the vector.
 */
export function toPlainText(source: string): string {
  return source
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+[.)]\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A summary for a card or a `<meta name="description">`, cut on a word. */
export function summarize(source: string, max = 160): string {
  const text = toPlainText(source);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
