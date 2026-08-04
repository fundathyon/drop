"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { ConfirmAction } from "@/components/confirm-action";
import { deleteUserAction, setUserActiveAction } from "./actions";

// Hidden entirely for the signed-in admin's own row by the caller — this
// mirrors the API's own refusal to let an admin disable or delete themselves
// (or the last active admin), so the UI never offers an action that would
// just come back as an error.
export function UserActions({ id, active, email }: { id: number; active: boolean; email: string }) {
  const t = useTranslations("users");
  const [pending, startTransition] = useTransition();

  function toggleActive() {
    startTransition(async () => {
      const result = await setUserActiveAction(id, !active);
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={toggleActive}>
        {active ? t("deactivate") : t("reactivate")}
      </Button>
      <ConfirmAction
        trigger={
          <Button variant="ghost" size="icon" aria-label={t("deleteUserAriaLabel", { email })}>
            <Icon name="trash-2" className="size-4" />
          </Button>
        }
        title={t("deleteUserTitle")}
        description={t("deleteUserDescription", { email })}
        action={() => deleteUserAction(id)}
      />
    </div>
  );
}
