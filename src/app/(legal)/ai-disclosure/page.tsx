import { getLegalDocument } from '@/lib/legal';

export default async function AiDisclosurePage() {
  const doc = await getLegalDocument('ai_disclosure');
  return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-3xl font-semibold">{doc?.title ?? 'AI Disclosure'}</h1><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{doc?.content ?? ''}</p></main>;
}
