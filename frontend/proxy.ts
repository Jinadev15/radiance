import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Deliberately NOT the backend's httpOnly `radiance_token` cookie — see the
// long comment in lib/api.ts's SESSION_FLAG_COOKIE. Short version: that
// cookie belongs to the *backend's* domain, and once the frontend and
// backend are deployed on two different domains (the normal outcome of
// free hosting — a Vercel frontend and a Render backend are not the same
// domain), this middleware — which only ever sees cookies scoped to the
// *frontend's* own domain — would never see it, and would bounce every
// page to /login even immediately after a successful login. This flag
// cookie is set by lib/api.ts on the frontend's own domain specifically so
// this check works regardless of deployment topology. It carries no auth
// power by itself; the backend enforces the real session on every API call.
const SESSION_FLAG_COOKIE = 'radiance_session';

// Route-level gate: presence of the session flag decides page access. The
// token's signature/expiry is still verified server-side on every API
// call (backend `auth` middleware) — this layer only controls navigation.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasToken = Boolean(request.cookies.get(SESSION_FLAG_COOKIE)?.value);

  // Handled directly here rather than left to app/page.tsx's redirect('/dashboard')
  // — that indirection meant a logged-out visit to "/" took two redirect hops
  // (/ -> /dashboard -> /login) instead of one, a visible extra round-trip.
  if (pathname === '/') {
    return NextResponse.redirect(new URL(hasToken ? '/dashboard' : '/login', request.url));
  }

  if (pathname.startsWith('/dashboard') && !hasToken) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === '/login' && hasToken) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Files under frontend/public/ (e.g. /logo.png) are served at the site
  // root, not under a "/public" prefix — the old `|public)` clause here
  // never actually matched anything and excluded nothing. This excludes by
  // extension instead, which is what actually keeps static assets out of
  // the redirect logic above.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
