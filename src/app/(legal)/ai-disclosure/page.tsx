import { getLegalDocument } from '@/lib/legal';

const fallback = `Switch & Save AI Assistant uses artificial intelligence to help answer questions, draft replies, search approved business knowledge, and assist with support workflows.

AI replies can be incomplete or incorrect. Users should double-check important information before relying on it, especially pricing, legal, financial, medical, safety, account, or operational decisions.

The assistant may use approved business information, connected tools, and authorised connector actions. Human agents can review and take over conversations when needed.`;

export default async function AiDisclosurePage() {
  const doc = await getLegalDocument('ai_disclosure');
  return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-3xl font-semibold">{doc?.title ?? 'AI Disclosure'}</h1><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{doc?.content ?? fallback}</p></main>;
}
