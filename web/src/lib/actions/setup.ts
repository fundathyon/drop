"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { api, ApiError } from "@/lib/api";
import { setSession } from "@/lib/session";

export interface SetupState {
  error?: string;
}

// No requireUser()/requireAdmin() here: by construction this action only ever
// runs while no admin exists yet (the page redirects away otherwise), so
// there is no session to check.
export async function setupAction(_prev: SetupState | undefined, formData: FormData): Promise<SetupState> {
  const orgName = String(formData.get("org_name") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("password_confirm") ?? "");
  const locale = await getLocale();

  if (password !== passwordConfirm) {
    return { error: "passwordMismatch" };
  }

  try {
    const tokens = await api.setup({
      org_name: orgName,
      name: name || undefined,
      email,
      password,
      password_confirm: passwordConfirm,
    });
    await setSession(tokens);
  } catch (err) {
    if (err instanceof ApiError) {
      // The Go side already returns a specific, safe validation message for
      // this one (e.g. "the password must be at least 8 characters") — show
      // it verbatim rather than inventing our own copy.
      if (err.code === "invalid_body") return { error: err.message };
      // Someone else finished setup first: send this tab to sign in instead
      // of dead-ending on an error.
      if (err.code === "already_set_up") return redirect({ href: "/login", locale });
    }
    return { error: "unexpected" };
  }

  return redirect({ href: "/", locale });
}
