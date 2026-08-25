import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { SHOW_PALETTE_TOOLS } from "./lib/flags";
import {
  SESSION_COOKIE,
  decodeSession,
  encodeSession,
  isAccessTokenStale,
} from "./lib/session-cookie";
import type { TokenResponse } from "./lib/types";

const intl = createMiddleware(routing);

// Routes reachable without a session: signing in, the first-run wizard, and
// accepting an invitation. Locale prefixes (e.g. "/en/login") are handled by
// stripping the segment before matching.
const publicRoutes = [
  "/login",
  "/setup",
  "/invitacion",
  // The palette page is a developer surface with no data on it, and it only
  // exists outside production (see lib/flags.ts) — reaching it should not
  // require a session, or checking a color would mean signing in first.
  ...(SHOW_PALETTE_TOOLS ? ["/colores"] : []),
];

function withoutLocalePrefix(pathname: string): string {
  const segments = pathname.split("/");
  if (segments.length > 1 && routing.locales.includes(segments[1] as never)) {
    return "/" + segments.slice(2).join("/");
  }
  return pathname;
}

// This is an optimistic check only: it looks at whether the session cookie
// exists and refreshes its access token when it is about to expire. Real
// authorization happens on every server-side call to the Go API, which
// verifies the token itself.
export default async function proxy(request: NextRequest) {
  const path = withoutLocalePrefix(request.nextUrl.pathname) || "/";
  const isPublic = publicRoutes.some(
    (route) => path === route || path === route + "/"
  );
  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  const session = raw ? decodeSession(raw) : null;

  if (!isPublic && !session) {
    const url = request.nextUrl.clone();
    const target = withoutLocalePrefix(url.pathname);
    url.pathname = "/login";
    if (target && target !== "/") {
      url.searchParams.set("next", target);
    }
    return NextResponse.redirect(url);
  }

  if (session && isAccessTokenStale(session)) {
    const refreshed = await refresh(session.refresh_token);
    if (!refreshed) {
      if (isPublic) {
        const response = intl(request);
        response.cookies.delete(SESSION_COOKIE);
        return response;
      }
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      const response = NextResponse.redirect(url);
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }
    const response = intl(request);
    response.cookies.set(SESSION_COOKIE, encodeSession(refreshed), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(refreshed.refresh_expires_at),
    });
    return response;
  }

  return intl(request);
}

async function refresh(refreshToken: string): Promise<TokenResponse | null> {
  try {
    const apiUrl = process.env.DROP_API_URL ?? "http://localhost:8000";
    const res = await fetch(`${apiUrl}/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as TokenResponse;
  } catch {
    return null;
  }
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
