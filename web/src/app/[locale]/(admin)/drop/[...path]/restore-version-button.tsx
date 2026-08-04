"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
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
        <Button variant="outline" size="sm">
          <Icon name="history" className="size-4" />
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
