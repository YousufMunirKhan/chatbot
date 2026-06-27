import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/lib/env';

/**
 * Browser Supabase client (anon key). Safe for client components.
 * RLS policies (Module 2 / Module 23) enforce tenant isolation.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  );
}
