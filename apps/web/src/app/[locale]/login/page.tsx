import { getCurrentUser } from "@/lib/session";
import { redirect } from "@/i18n/navigation";
import { safeNext } from "@/lib/safe-next";
import { api } from "@/lib/api";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; email?: string; message?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;

  // A never-set-up instance rejects login outright (the Go API 503s
  // everything but /v1/setup* until an administrator exists) — send a fresh
  // visitor to create one instead of showing a form that cannot work yet.
  const status = await api.setupStatus();
  if (status.needs_setup) {
    return redirect({ href: "/setup", locale });
  }

  const user = await getCurrentUser();
  if (user) {
    return redirect({ href: safeNext(query.next), locale });
  }

  return (
    <AuthShell>
      <LoginForm next={safeNext(query.next)} email={query.email ?? ""} message={query.message} />
    </AuthShell>
  );
}
