// Port of safeNext in api/internal/httpapi/adminauth.go: keeps a post-login
// redirect on this site, so a crafted `next` cannot turn the login form into
// an open redirect.
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  try {
    new URL(next, "http://localhost");
  } catch {
    return "/";
  }
  return next;
}
