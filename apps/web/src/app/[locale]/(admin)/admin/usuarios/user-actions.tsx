"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button, IconButton, useToast } from "@foundathyon/community-ui";
import { ConfirmAction } from "@/components/confirm-action";
import { deleteUserAction, setUserActiveAction } from "./actions";

// Hidden entirely for the signed-in admin's own row by the caller — this
// mirrors the API's own refusal to let an admin disable or delete themselves
// (or the last active admin), so the UI never offers an action that would
// just come back as an error.
export function UserActions({ id, active, email }: { id: number; active: boolean; email: string }) {
  const t = useTranslations("users");
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function toggleActive() {
    startTransition(async () => {
      const result = await setUserActiveAction(id, !active);
      if (result?.error) toast({ title: result.error, tone: "danger" });
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" size="sm" loading={pending} onClick={toggleActive}>
        {active ? t("deactivate") : t("reactivate")}
      </Button>
      <ConfirmAction
        trigger={
          <IconButton variant="destructive-subtle" icon={Trash2} label={t("deleteUserAriaLabel", { email })} />
        }
        title={t("deleteUserTitle")}
        description={t("deleteUserDescription", { email })}
        action={() => deleteUserAction(id)}
      />
    </div>
  );
}
