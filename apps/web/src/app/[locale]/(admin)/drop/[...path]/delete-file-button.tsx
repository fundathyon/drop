"use client";

import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { IconButton } from "@foundathyon/community-ui";
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
        <IconButton
          variant="destructive-subtle"
          icon={Trash2}
          label={t("files.deleteAriaLabel", { name })}
        />
      }
      title={t("files.deleteTitle")}
      description={t("files.deleteDescription", { name })}
      action={() => deleteFileAction(fullPath, owner)}
    />
  );
}
