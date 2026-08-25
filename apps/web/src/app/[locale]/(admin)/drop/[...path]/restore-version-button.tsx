"use client";

import { useTranslations } from "next-intl";
import { History } from "lucide-react";
import { Button } from "@foundathyon/community-ui";
import { ConfirmAction } from "@/components/confirm-action";
import { activateVersionAction } from "./actions";

export function RestoreVersionButton({
  path,
  owner,
  seq,
}: {
  path: string;
  owner?: number;
  seq: number;
}) {
  const t = useTranslations("drop");

  return (
    <ConfirmAction
      trigger={
        <Button variant="secondary" size="sm" leading={<History />}>
          {t("versions.restore")}
        </Button>
      }
      title={t("versions.restoreTitle", { seq })}
      description={t("versions.restoreDescription", { seq })}
      destructive={false}
      confirmLabel={t("versions.restore")}
      action={() => activateVersionAction(path, seq, owner)}
    />
  );
}
