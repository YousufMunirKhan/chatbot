import { createSupabaseServiceClient } from '@/lib/db/server';

export async function getLegalDocument(key: string): Promise<{ title: string; content: string; version: number } | null> {
  const { data } = await createSupabaseServiceClient()
    .from('legal_documents')
    .select('title,content,version')
    .eq('key', key)
    .maybeSingle();
  if (!data) return null;
  return { title: data.title as string, content: data.content as string, version: data.version as number };
}
