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
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const locale = await getLocale();

  try {
    const tokens = await api.setup({
      org_name: orgName,
      // `name` is left out on purpose: the wizard no longer asks for it and the
      // Go side falls back to the local part of the email
      // (auth.Service.SetupInstance), which is a better default than an empty
      // string anyway.
      //
      // `password_confirm` is still sent because the endpoint requires the
      // field and rejects a mismatch — but the form asks for the password once,
      // so there is nothing to compare and echoing it is the honest way to
      // satisfy a contract the UI no longer participates in.
      email,
      password,
      password_confirm: password,
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
