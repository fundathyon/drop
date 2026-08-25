"use client";

import { useTranslations } from "next-intl";
import { Button } from "@foundathyon/community-ui";
import { ConfirmAction } from "@/components/confirm-action";
import { revokeInvitationAction } from "./actions";

export function RevokeInvitationButton({ id, email }: { id: number; email: string }) {
  const t = useTranslations("users");

  return (
    <ConfirmAction
      trigger={
        <Button variant="secondary" size="sm">
          {t("revoke")}
        </Button>
      }
      title={t("revokeInvitationTitle")}
      description={t("revokeInvitationDescription", { email })}
      confirmLabel={t("revoke")}
      action={() => revokeInvitationAction(id)}
    />
  );
}
