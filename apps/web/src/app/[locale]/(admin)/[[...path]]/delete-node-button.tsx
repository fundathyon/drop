"use client";

import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { IconButton } from "@foundathyon/community-ui";
import { ConfirmAction } from "@/components/confirm-action";
import { deleteNodeAction } from "./actions";
import type { Kind } from "@/lib/types";

export function DeleteNodeButton({
  path,
  owner,
  name,
  kind,
}: {
  path: string;
  owner?: number;
  name: string;
  kind: Kind;
}) {
  const t = useTranslations("explorer");

  return (
    <ConfirmAction
      trigger={<IconButton variant="destructive-subtle" size="sm" icon={Trash2} label={t("deleteAriaLabel", { name })} />}
      title={kind === "drop" ? t("deleteDropTitle") : t("deleteFolderTitle")}
      description={t("deleteText", { name })}
      action={() => deleteNodeAction(path, owner)}
    />
  );
}
