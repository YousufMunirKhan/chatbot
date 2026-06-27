import { getLegalDocument } from '@/lib/legal';

export default async function PrivacyPage() {
  const doc = await getLegalDocument('privacy');
  return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-3xl font-semibold">{doc?.title ?? 'Privacy Policy'}</h1><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{doc?.content ?? ''}</p></main>;
}
