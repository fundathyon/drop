import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import {
  SESSION_COOKIE,
  decodeSession,
  encodeSession,
  type SessionPayload,
} from "./session-cookie";
import type { TokenResponse, UserInfo } from "./types";

// The session cookie is set only from Server Actions (login, setup, invite
// accept) — proxy.ts refreshes it on the way in, but never creates it.
export async function setSession(tokens: TokenResponse) {
  const store = await cookies();
  store.set(SESSION_COOKIE, encodeSession(tokens), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(tokens.refresh_expires_at),
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

// Memoized per request: several Server Components on the same page can all
// ask for the session without re-parsing the cookie each time.
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  return raw ? decodeSession(raw) : null;
});

export async function getAccessToken(): Promise<string | null> {
  const session = await getSession();
  return session?.access_token ?? null;
}

export async function getCurrentUser(): Promise<UserInfo | null> {
  const session = await getSession();
  return session?.user ?? null;
}

// requireUser is the DAL entry point pages use: it redirects to /login (proxy
// already does this optimistically, but Server Components must not assume
// they were reached through it) rather than letting a caller handle "no
// session" as if it were a normal, recoverable case.
export async function requireUser(): Promise<UserInfo> {
  const user = await getCurrentUser();
  if (!user) {
    return redirect({ href: "/login", locale: await getLocale() });
  }
  return user;
}

export async function requireAdmin(): Promise<UserInfo> {
  const user = await requireUser();
  if (user.role !== "admin") {
    return redirect({ href: "/", locale: await getLocale() });
  }
  return user;
}
