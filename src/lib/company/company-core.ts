import { cache } from 'react';
import { getSessionUser } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/db/server';

/**
 * The signed-in company's row, read ONCE per request.
 *
 * Three unrelated places needed something off `companies` on every single
 * dashboard page: the layout wanted the name, the translation layer wanted
 * `default_language`, and support settings wanted `timezone`. Each did its own
 * `select ... from companies where id = ?`, so every page paid three reads of
 * the same row — and on this deployment a round trip costs ~230 ms regardless
 * of what it asks for, so that was ~0.7 s of identical work.
 *
 * `cache()` is React's per-request memo (the same mechanism `getSessionUser()`
 * uses), so the layout, the page and every reader inside them share one read.
 * The subscription is embedded rather than fetched separately for the same
 * reason: it is free once the row is already being fetched.
 *
 * Returns `null` rather than redirecting, because the translation layer runs
 * for platform-only super admins too and must never fail a render.
 */
export const getCompanyCoreRow = cache(async function getCompanyCoreRow(): Promise<Record<
  string,
  unknown
> | null> {
  const user = await getSessionUser();
  if (!user?.companyId) return null;
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('companies')
    .select('*, subscriptions(*)')
    .eq('id', user.companyId) // scope prevents cross-company access
    .maybeSingle();
  // Thrown rather than swallowed so a transient failure still reads as one.
  // The translation layer catches it and falls back to English.
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
});
