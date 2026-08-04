"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { acceptInvitationAction, type InviteAcceptState } from "@/lib/actions/invite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PasswordInput } from "@/components/password-input";
import { Icon } from "@/components/icon";
import type { InvitationInfo } from "@/lib/types";

// Keys that live in the `invite` namespace and should be translated; anything
// else in state.error is a message the Go API already generated (verbatim,
// safe to show as-is) for an invalid_body response.
const KNOWN_ERRORS = ["passwordMismatch"];

export function InviteForm({ token, invitation }: { token: string; invitation: InvitationInfo | null }) {
  const t = useTranslations("invite");
  const [state, action, pending] = useActionState<InviteAcceptState, FormData>(acceptInvitationAction, {});

  // A link that goes bad between page-load and submit (expired/revoked/
  // accepted mid-flight) falls through to the exact same view as one that
  // was already bad when the page loaded.
  if (!invitation || state.error === "invalidInvitation") {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-start gap-2">
          <Icon name="package" className="size-8" />
          <h1 className="text-xl font-semibold">{t("title")}</h1>
        </div>

        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <Icon name="triangle-alert" className="size-4 shrink-0" />
          {t("invalidMessage")}
        </p>

        <p className="text-center text-sm text-muted-foreground">{t("invalidFooter")}</p>

        <Button asChild variant="outline" className="w-full">
          <Link href="/login">{t("goToLogin")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-2">
        <Icon name="package" className="size-8" />
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t.rich("invitedDescription", {
            email: () => <strong className="text-foreground">{invitation.email}</strong>,
            role: () => (
              <Badge variant="secondary">{invitation.role === "admin" ? t("roleAdmin") : t("roleUser")}</Badge>
            ),
          })}
        </p>
      </div>

      {state?.error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <Icon name="triangle-alert" className="size-4 shrink-0" />
          {KNOWN_ERRORS.includes(state.error) ? t(state.error) : state.error}
        </p>
      )}

      <input type="hidden" name="token" value={token} />

      <div className="grid gap-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" autoComplete="name" placeholder={t("namePlaceholder")} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password">{t("password")}</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          showLabel={t("showPassword")}
          hideLabel={t("hidePassword")}
        />
        <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password_confirm">{t("passwordConfirm")}</Label>
        <PasswordInput
          id="password_confirm"
          name="password_confirm"
          autoComplete="new-password"
          required
          showLabel={t("showPassword")}
          hideLabel={t("hidePassword")}
        />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {t("submit")}
      </Button>
    </form>
  );
}
