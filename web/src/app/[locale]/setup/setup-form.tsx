"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { setupAction, type SetupState } from "@/lib/actions/setup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/password-input";
import { Icon } from "@/components/icon";

// Keys that live in the `setup` namespace and should be translated; anything
// else in state.error is a message the Go API already generated (verbatim,
// safe to show as-is) for an invalid_body response.
const KNOWN_ERRORS = ["passwordMismatch", "unexpected"];

export function SetupForm() {
  const t = useTranslations("setup");
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, {});

  return (
    <form action={action} className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-2">
        <Icon name="package" className="size-8" />
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {state?.error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <Icon name="triangle-alert" className="size-4 shrink-0" />
          {KNOWN_ERRORS.includes(state.error) ? t(state.error) : state.error}
        </p>
      )}

      <div className="grid gap-2">
        <Label htmlFor="org_name">{t("orgName")}</Label>
        <Input id="org_name" name="org_name" autoComplete="organization" required autoFocus />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" autoComplete="name" placeholder={t("namePlaceholder")} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
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

      <p className="text-center text-sm text-muted-foreground">{t("footer")}</p>
    </form>
  );
}
