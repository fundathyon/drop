import type { TokenResponse } from "./types";

// Kept separate from lib/session.ts (which is server-only) so proxy.ts —
// which cannot import server-only code — can still decode and refresh the
// cookie itself.
export const SESSION_COOKIE = "drop_web_session";

export interface SessionPayload {
  access_token: string;
  access_expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
  user: TokenResponse["user"];
}

export function encodeSession(tokens: TokenResponse): string {
  const payload: SessionPayload = {
    access_token: tokens.access_token,
    access_expires_at: tokens.expires_at,
    refresh_token: tokens.refresh_token,
    refresh_expires_at: tokens.refresh_expires_at,
    user: tokens.user,
  };
  return JSON.stringify(payload);
}

export function decodeSession(raw: string): SessionPayload | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.access_token === "string" && typeof parsed?.refresh_token === "string") {
      return parsed as SessionPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// A minute of slack before the real expiry, so a request that starts just
// before the token dies does not race it.
const REFRESH_SLACK_MS = 60_000;

export function isAccessTokenStale(payload: SessionPayload): boolean {
  return Date.parse(payload.access_expires_at) - Date.now() < REFRESH_SLACK_MS;
}
