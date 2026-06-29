import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getHelpCenter } from '@/modules/help-center/data';
import { HelpCenterList } from '@/modules/help-center/help-center-list';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { publicBotId: string } }): Promise<Metadata> {
  const data = await getHelpCenter(params.publicBotId);
  return { title: data ? data.brand.title : 'Help Center' };
}

export default async function HelpCenterPage({ params }: { params: { publicBotId: string } }) {
  const data = await getHelpCenter(params.publicBotId);
  if (!data) notFound();
  const { brand, articles } = data;

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="px-6 py-12 text-white" style={{ background: brand.primaryColor }}>
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold">{brand.title}</h1>
          <p className="mt-2 text-white/80">Find answers, guides, and frequently asked questions.</p>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        {articles.length === 0 ? (
          <p className="text-center text-slate-500">No published help articles yet.</p>
        ) : (
          <HelpCenterList publicBotId={brand.publicBotId} articles={articles} accent={brand.primaryColor} />
        )}
      </div>

      <footer className="px-6 py-8 text-center text-xs text-slate-400">
        Powered by {brand.name}
      </footer>
    </main>
  );
}
