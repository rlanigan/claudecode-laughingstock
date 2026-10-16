// Auth gate (HANDOFF.md §9). Checks for the Auth.js session cookie only; the real session
// lookup happens in the (app) layout and the API handler wrapper, so this stays dependency-free.
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = [/^\/login(\/|$)/, /^\/api\/auth(\/|$)/, /^\/api\/cron(\/|$)/, /^\/api\/health$/, /^\/offline$/, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/icons\//, /^\/_next\//, /^\/favicon\.ico$/, /^\/dev\//];

function hasSessionCookie(req: NextRequest): boolean {
  return !!(req.cookies.get("authjs.session-token") ?? req.cookies.get("__Secure-authjs.session-token"));
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (hasSessionCookie(req)) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "You've been signed out. Sign in again." } }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
