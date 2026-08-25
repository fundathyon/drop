"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { ConfirmAction } from "@/components/confirm-action";
import { deleteFileAction } from "./actions";

export function DeleteFileButton({
  fullPath,
  owner,
  name,
}: {
  fullPath: string;
  owner?: number;
  name: string;
}) {
  const t = useTranslations("drop");

  return (
    <ConfirmAction
      trigger={
        <Button variant="ghost" size="icon" aria-label={t("files.deleteAriaLabel", { name })}>
          <Icon name="trash-2" className="size-4" />
        </Button>
      }
      title={t("files.deleteTitle")}
      description={t("files.deleteDescription", { name })}
      action={() => deleteFileAction(fullPath, owner)}
    />
  );
}
