import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const TOKEN_COOKIE = 'radiance_token';

// Route-level gate: presence of the session cookie decides page access.
// The token's signature/expiry is still verified server-side on every API
// call (backend `auth` middleware) — this layer only controls navigation.
//
// The cookie is httpOnly and set by the backend (see routes/auth.js). In
// local dev both apps share the hostname "localhost" (only the port
// differs), and cookie scope ignores port — so a cookie set by the backend
// on :5000 is visible here to requests hitting the frontend on :3000. In a
// production deployment where the dashboard and API live on different
// domains, this needs either a shared parent cookie domain or for this
// middleware to validate against the backend directly instead of just
// checking presence.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasToken = Boolean(request.cookies.get(TOKEN_COOKIE)?.value);

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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
