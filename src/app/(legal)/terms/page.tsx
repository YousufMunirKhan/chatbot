import { getLegalDocument } from '@/lib/legal';

export default async function TermsPage() {
  const doc = await getLegalDocument('terms');
  return <Legal title={doc?.title ?? 'Terms of Service'} content={doc?.content ?? ''} />;
}

function Legal({ title, content }: { title: string; content: string }) {
  return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-3xl font-semibold">{title}</h1><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{content}</p></main>;
}
