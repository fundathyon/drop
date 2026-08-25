"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { api, ApiError } from "@/lib/api";

export interface InviteAcceptState {
  error?: string;
}

// Deliberately does not call setSession(): accepting an invitation must not
// sign the new account in by design — the password just chosen is the one
// immediately used to log in, same as the original Go admin.
export async function acceptInvitationAction(
  _prev: InviteAcceptState | undefined,
  formData: FormData
): Promise<InviteAcceptState> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("password_confirm") ?? "");
  const locale = await getLocale();

  if (password !== passwordConfirm) {
    return { error: "passwordMismatch" };
  }

  let email: string;
  try {
    const user = await api.acceptInvitation({
      token,
      name: name || undefined,
      password,
      password_confirm: passwordConfirm,
    });
    email = user.email;
  } catch (err) {
    // The Go side gives a specific, safe validation message for this one —
    // show it verbatim. Any other failure (expired/revoked/accepted mid-flight,
    // or anything else) falls through to the same generic "not acceptable"
    // view the page shows when the token was already bad on load — no need
    // to re-fetch the invitation here to work out which reason applied.
    if (err instanceof ApiError && err.code === "invalid_body") {
      return { error: err.message };
    }
    return { error: "invalidInvitation" };
  }

  return redirect({
    href: `/login?email=${encodeURIComponent(email)}&message=accountCreated`,
    locale,
  });
}
