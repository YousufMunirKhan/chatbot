'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ArticleSummary } from './data';

export function HelpCenterList({
  publicBotId,
  articles,
  accent,
}: {
  publicBotId: string;
  articles: ArticleSummary[];
  accent: string;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return articles;
    return articles.filter(
      (a) => a.title.toLowerCase().includes(needle) || a.excerpt.toLowerCase().includes(needle),
    );
  }, [q, articles]);

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search help articles…"
        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-slate-500"
        style={{ borderColor: q ? accent : undefined }}
      />

      {filtered.length === 0 ? (
        <p className="mt-8 text-center text-slate-500">No articles match “{q}”.</p>
      ) : (
        <ul className="mt-6 grid gap-3">
          {filtered.map((a) => (
            <li key={a.id}>
              <Link
                href={`/help/${encodeURIComponent(publicBotId)}/${a.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:shadow-md"
              >
                <p className="text-lg font-semibold text-slate-900">{a.title}</p>
                {a.excerpt ? <p className="mt-1 line-clamp-2 text-sm text-slate-500">{a.excerpt}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
