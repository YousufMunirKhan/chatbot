import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';

/**
 * Server Supabase client bound to the request's auth cookie.
 * Use inside server components and route handlers so RLS applies as the
 * logged-in user.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  const e = serverEnv();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // `setAll` can be called from a Server Component where mutation is not
          // allowed; safe to ignore when middleware refreshes the session.
        }
      },
    },
  });
}

/**
 * Service-role client — BYPASSES RLS. Use ONLY in trusted server code
 * (background jobs, webhooks, super-admin actions). Never expose to the client.
 * Every query MUST scope by `company_id` manually to preserve tenant isolation.
 */
export function createSupabaseServiceClient() {
  const e = serverEnv();
  if (!e.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for the service-role client.');
  }
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
