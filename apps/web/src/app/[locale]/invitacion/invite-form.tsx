"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Eye, EyeOff, Lock, Mail, TriangleAlert, User } from "lucide-react";
import { BrandMark, BrandPanel } from "@/components/brand-panel";
import { Link } from "@/i18n/navigation";
import { acceptInvitationAction, type InviteAcceptState } from "@/lib/actions/invite";
import type { InvitationInfo } from "@/lib/types";

// Same first-run shell as login and setup. Not part of the "make it like
// dokgistry" request on its own, but it is the third screen of the same
// family — leaving it on the old split-panel layout would have meant two
// different-looking sign-in flows in one product.
const KNOWN_ERRORS = ["passwordMismatch"];

export function InviteForm({ token, invitation }: { token: string; invitation: InvitationInfo | null }) {
  const t = useTranslations("invite");
  const [showPassword, setShowPassword] = useState(false);
  const [state, action, pending] = useActionState<InviteAcceptState, FormData>(acceptInvitationAction, {});

  // A link that goes bad between page-load and submit (expired/revoked/
  // accepted mid-flight) falls through to the exact same view as one that
  // was already bad when the page loaded.
  const unusable = !invitation || state.error === "invalidInvitation";

  return (
    <div className="onboarding">
      <BrandPanel headline={t("headline")} tagline={t("tagline")} />

      <section className="onboardingFormPane">
        <div className="onboardingFormCard">
          <BrandMark />

          <div className="onboardingCard">
            {unusable ? (
              <>
                <span className="pillBadge pillBadgeAccent">
                  <TriangleAlert aria-hidden="true" />
                  {t("invalidPill")}
                </span>
                <h2>{t("title")}</h2>
                <p className="onboardingError" role="alert">
                  {t("invalidMessage")}
                </p>
                <p className="onboardingSubtitle">{t("invalidFooter")}</p>
                <div className="onboardingNav">
                  <Link href="/login" className="buttonPrimary">
                    {t("goToLogin")}
                    <ArrowRight className="buttonIcon" aria-hidden="true" />
                  </Link>
                </div>
              </>
            ) : (
              <>
                <span className="pillBadge pillBadgeAccent">
                  <Mail aria-hidden="true" />
                  {t("pill")}
                </span>

                <h2>{t("heading")}</h2>
                <p className="onboardingSubtitle">
                  {t.rich("invitedDescription", {
                    email: () => <strong>{invitation.email}</strong>,
                    role: () => <strong>{invitation.role === "admin" ? t("roleAdmin") : t("roleUser")}</strong>,
                  })}
                </p>

                <form action={action} className="onboardingForm">
                  <input type="hidden" name="token" value={token} />

                  <div className="field">
                    <label htmlFor="name">{t("name")}</label>
                    <div className="inputIconWrap">
                      <User className="inputIcon" aria-hidden="true" />
                      <input
                        id="name"
                        name="name"
                        autoComplete="name"
                        autoFocus
                        placeholder={t("namePlaceholder2")}
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

                  <div className="field">
                    <label htmlFor="password_confirm">{t("passwordConfirm")}</label>
                    <div className="inputIconWrap">
                      <Lock className="inputIcon" aria-hidden="true" />
                      <input
                        id="password_confirm"
                        name="password_confirm"
                        type={showPassword ? "text" : "password"}
                        required
                        minLength={8}
                        autoComplete="new-password"
                        placeholder={t("passwordConfirmPlaceholder")}
                      />
                    </div>
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
                </form>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
