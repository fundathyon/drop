"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { api, ApiError } from "@/lib/api";
import { clearSession, getSession, setSession } from "@/lib/session";
import { safeNext } from "@/lib/safe-next";

export interface LoginState {
  error?: "invalidCredentials" | "accountDisabled" | "tooManyAttempts" | "unexpectedError";
  email?: string;
}

export async function loginAction(_prev: LoginState | undefined, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  try {
    const tokens = await api.login(email, password);
    await setSession(tokens);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === "invalid_credentials") return { error: "invalidCredentials", email };
      if (err.code === "account_disabled") return { error: "accountDisabled", email };
      if (err.code === "too_many_attempts") return { error: "tooManyAttempts", email };
    }
    return { error: "unexpectedError", email };
  }

  return redirect({ href: safeNext(next), locale: await getLocale() });
}

export async function logoutAction() {
  const session = await getSession();
  if (session) {
    try {
      await api.logout(session.refresh_token);
    } catch {
      // The cookie is going regardless: leaving someone signed in because the
      // revocation call failed is the worse outcome.
    }
  }
  await clearSession();
  redirect({ href: "/login", locale: await getLocale() });
}
