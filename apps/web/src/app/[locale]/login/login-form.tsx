"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { BrandMark, BrandPanel } from "@/components/brand-panel";
import { loginAction, type LoginState } from "@/lib/actions/auth";

// Structurally the same screen as dokgistry's components/LoginScreen.tsx —
// same brand panel, same card, same pill badge, same icon-in-field inputs —
// so both products' sign-in reads as one family. Three differences, all
// deliberate:
//
//  * it submits through Drop's existing Server Action instead of fetch(), so
//    the redirect and the session cookie keep working exactly as before;
//  * the copy comes from next-intl, because Drop ships in two languages;
//  * there is no "remember this device" checkbox. dokgistry has one, but
//    Drop's API has no such concept (see loginAction / POST /v1/auth/login),
//    and a checkbox that changes nothing is worse than no checkbox.
const LOGIN_ERRORS = ["invalidCredentials", "accountDisabled", "tooManyAttempts"];

export function LoginForm({
  next,
  email,
  message,
}: {
  next: string;
  email: string;
  message?: string;
}) {
  const t = useTranslations("login");
  const tc = useTranslations("common");
  const [showPassword, setShowPassword] = useState(false);
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, { email });

  // loginAction can also report "unexpectedError", which lives in the common
  // namespace rather than this one — translating it here would miss.
  const errorText = state?.error
    ? LOGIN_ERRORS.includes(state.error)
      ? t(state.error)
      : tc("unexpectedError")
    : null;

  return (
    <div className="onboarding">
      <BrandPanel headline={t("headline")} tagline={t("tagline")} />

      <section className="onboardingFormPane">
        <div className="onboardingFormCard">
          <BrandMark />

          <div className="onboardingCard">
            <span className="pillBadge pillBadgeAccent">
              <ShieldCheck aria-hidden="true" />
              {t("pill")}
            </span>

            <h2>{t("heading")}</h2>
            <p className="onboardingSubtitle">{t("subtitle")}</p>

            <form action={action} className="onboardingForm">
              <input type="hidden" name="next" value={next} />

              <div className="field">
                <label htmlFor="email">{t("email")}</label>
                <div className="inputIconWrap">
                  <Mail className="inputIcon" aria-hidden="true" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoFocus
                    autoComplete="username"
                    placeholder={t("emailPlaceholder")}
                    defaultValue={state?.email ?? email}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="password">{t("password")}</label>
                <div className="inputIconWrap">
                  <Lock className="inputIcon" aria-hidden="true" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    placeholder={t("passwordPlaceholder")}
                    className="hasTrailingIcon"
                  />
                  <button
                    type="button"
                    className="inputTrailingButton"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </div>
              </div>

              {!state?.error && message && (
                <p className="onboardingNotice" role="status">
                  {t(message)}
                </p>
              )}
              {errorText && (
                <p className="onboardingError" role="alert">
                  {errorText}
                </p>
              )}

              <button type="submit" className="buttonPrimary" disabled={pending}>
                {pending ? (
                  t("submitting")
                ) : (
                  <>
                    {t("submit")}
                    <ArrowRight className="buttonIcon" aria-hidden="true" />
                  </>
                )}
              </button>

              <p className="stepCaption">{t("footer")}</p>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
