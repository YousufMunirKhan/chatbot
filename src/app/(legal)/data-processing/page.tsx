import { getLegalDocument } from '@/lib/legal';

const fallback = `This platform processes business knowledge, chat messages, leads, appointments, and operational data so AI assistants and authorised human agents can answer customers.

Upload only data you have permission to use. Do not upload payment card numbers, passwords, special category data, or unnecessary personal information.

We use data minimisation, access controls, audit logs, retention controls, and deletion/export workflows to support UK GDPR obligations. Customers remain responsible for their own privacy notices and lawful basis for data they add to the platform.`;

export default async function DataProcessingPage() {
  const doc = await getLegalDocument('data_processing');
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-8">
      <h1 className="text-3xl font-semibold">{doc?.title ?? 'Data Processing Notice'}</h1>
      <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
        {doc?.content ?? fallback}
      </p>
    </main>
  );
}
