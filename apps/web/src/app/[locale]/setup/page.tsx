import { api } from "@/lib/api";
import { redirect } from "@/i18n/navigation";
import { SetupForm } from "./setup-form";

export default async function SetupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  // No requireUser() here — this page exists precisely because no admin has
  // been created yet. Once one has, the wizard hands off to /login.
  const status = await api.setupStatus();
  if (!status.needs_setup) {
    return redirect({ href: "/login", locale });
  }

  return <SetupForm />;
}
