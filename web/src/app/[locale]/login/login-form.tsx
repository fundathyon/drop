"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { loginAction, type LoginState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";

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
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {
    email,
  });

  return (
    <form action={action} className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-2">
        <Icon name="package" className="size-8" />
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {!state?.error && message && (
        <p className="flex items-center gap-2 text-sm text-success">
          <Icon name="circle-check" className="size-4 shrink-0" />
          {t(message)}
        </p>
      )}

      {state?.error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <Icon name="triangle-alert" className="size-4 shrink-0" />
          {t(state.error)}
        </p>
      )}

      <input type="hidden" name="next" value={next} />

      <div className="grid gap-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          defaultValue={state?.email ?? email}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {t("submit")}
      </Button>

      <p className="text-center text-sm text-muted-foreground">{t("footer")}</p>
    </form>
  );
}
