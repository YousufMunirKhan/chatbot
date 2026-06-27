import { NextResponse, type NextRequest } from 'next/server';

/**
 * Auth middleware (Module 3).
 *  - Blocks requests with no Supabase session cookie from dashboard areas.
 *
 * Middleware runs on the Edge runtime, so keep it free of Supabase SDK imports.
 * Real auth, session refresh, two-factor checks, and role enforcement happen in
 * server layouts/actions via requireUser()/requireRole().
 */
const PROTECTED_PREFIXES = ['/dashboard', '/super-admin', '/company'];

function hasSupabaseSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((cookie) => /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name));
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));

  if (isProtected && !hasSupabaseSessionCookie(request)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('next', path);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except static assets, the public widget, and API routes
  // (webhooks/health manage their own auth).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|widget|api).*)'],
};
