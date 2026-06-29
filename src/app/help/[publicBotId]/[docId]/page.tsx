import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getHelpCenterArticle } from '@/modules/help-center/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: { publicBotId: string; docId: string };
}): Promise<Metadata> {
  const data = await getHelpCenterArticle(params.publicBotId, params.docId);
  return { title: data ? `${data.article.title} — ${data.brand.title}` : 'Article' };
}

export default async function HelpArticlePage({
  params,
}: {
  params: { publicBotId: string; docId: string };
}) {
  const data = await getHelpCenterArticle(params.publicBotId, params.docId);
  if (!data) notFound();
  const { brand, article } = data;
  const paragraphs = article.content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="px-6 py-8 text-white" style={{ background: brand.primaryColor }}>
        <div className="mx-auto max-w-3xl">
          <Link href={`/help/${encodeURIComponent(brand.publicBotId)}`} className="text-sm text-white/80 hover:underline">
            ← {brand.title}
          </Link>
          <h1 className="mt-2 text-2xl font-bold">{article.title}</h1>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-8">
        <div className="space-y-4 text-[15px] leading-relaxed text-slate-800">
          {paragraphs.length === 0 ? (
            <p className="text-slate-500">This article has no content yet.</p>
          ) : (
            paragraphs.map((p, i) => (
              <p key={i} className="whitespace-pre-wrap">
                {p}
              </p>
            ))
          )}
        </div>
      </article>

      <footer className="px-6 py-8 text-center text-xs text-slate-400">Powered by {brand.name}</footer>
    </main>
  );
}
