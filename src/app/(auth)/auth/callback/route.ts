import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/db/server';

/**
 * OAuth / email-link callback. Supabase redirects here with a `code`; we
 * exchange it for a session cookie, then forward to the app.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
