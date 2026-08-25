"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Building2, Eye, EyeOff, Lock, Mail, Rocket } from "lucide-react";
import { BrandMark, BrandPanel } from "@/components/brand-panel";
import { setupAction, type SetupState } from "@/lib/actions/setup";

// Keys that live in the `setup` namespace and should be translated; anything
// else in state.error is a message the Go API already generated (verbatim,
// safe to show as-is) for an invalid_body response.
const KNOWN_ERRORS = ["unexpected"];

/**
 * The first-run screen, in the shape of dokgistry's onboarding (brand panel,
 * pill badge, icon-in-field inputs) but a single step: organization, email and
 * password, asked once.
 *
 * No display-name field: the API takes `name` as optional and falls back to the
 * local part of the email (apps/api/internal/auth/service.go), so asking for it
 * bought a field and nothing else. No password confirmation either — the value
 * is visible on demand through the reveal toggle, which is the check that
 * actually helps.
 */
export function SetupForm() {
  const t = useTranslations("setup");
  const [showPassword, setShowPassword] = useState(false);
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, {});

  return (
    <div className="onboarding">
      <BrandPanel headline={t("headline")} tagline={t("tagline")} />

      <section className="onboardingFormPane">
        <div className="onboardingFormCard">
          <BrandMark />

          <div className="onboardingCard">
            <span className="pillBadge pillBadgeAccent">
              <Rocket aria-hidden="true" />
              {t("pill")}
            </span>

            <h2>{t("title")}</h2>
            <p className="onboardingSubtitle">{t("description")}</p>

            <form action={action} className="onboardingForm">
              <div className="field">
                <label htmlFor="org_name">{t("orgName")}</label>
                <div className="inputIconWrap">
                  <Building2 className="inputIcon" aria-hidden="true" />
                  <input
                    id="org_name"
                    name="org_name"
                    required
                    autoFocus
                    autoComplete="organization"
                    placeholder={t("orgNamePlaceholder")}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="email">{t("email")}</label>
                <div className="inputIconWrap">
                  <Mail className="inputIcon" aria-hidden="true" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder={t("emailPlaceholder")}
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
                    minLength={8}
                    autoComplete="new-password"
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
                <p className="fieldHint">{t("passwordHint")}</p>
              </div>

              {state?.error && (
                <p className="onboardingError" role="alert">
                  {KNOWN_ERRORS.includes(state.error) ? t(state.error) : state.error}
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
