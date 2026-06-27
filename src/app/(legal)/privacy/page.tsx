import { getLegalDocument } from '@/lib/legal';

const fallback = `We process account details, company settings, chat messages, knowledge documents, leads, appointments, and connector metadata to provide the Switch & Save AI Assistant platform.

We use this data to operate the service, secure accounts, improve assistant quality, support human handoff, and provide audit and retention controls. Customers control the business data they upload or connect.

Do not submit unnecessary personal information, payment card numbers, passwords, or sensitive data through the assistant. Contact the platform owner for access, correction, deletion, or export requests.`;

export default async function PrivacyPage() {
  const doc = await getLegalDocument('privacy');
  return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-3xl font-semibold">{doc?.title ?? 'Privacy Policy'}</h1><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{doc?.content ?? fallback}</p></main>;
}
