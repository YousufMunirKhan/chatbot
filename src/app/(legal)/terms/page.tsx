import { getLegalDocument } from '@/lib/legal';

const fallback = `By using Switch & Save AI Assistant, you agree to use the platform lawfully and only with data you are authorised to process.

AI-generated responses are provided for assistance and may require human review. You remain responsible for your business decisions, customer communications, uploaded knowledge, connected systems, and connector permissions.

You must not misuse the service, attempt unauthorised access, expose connector tokens publicly, or upload prohibited or unnecessary sensitive information.`;

export default async function TermsPage() {
  const doc = await getLegalDocument('terms');
  return <Legal title={doc?.title ?? 'Terms of Service'} content={doc?.content ?? fallback} />;
}

function Legal({ title, content }: { title: string; content: string }) {
  return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-3xl font-semibold">{title}</h1><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{content}</p></main>;
}
