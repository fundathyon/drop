"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
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
      trigger={
        <Button variant="ghost" size="icon" aria-label={t("deleteAriaLabel", { name })}>
          <Icon name="trash-2" className="size-4" />
        </Button>
      }
      title={kind === "drop" ? t("deleteDropTitle") : t("deleteFolderTitle")}
      description={t("deleteText", { name })}
      action={() => deleteNodeAction(path, owner)}
    />
  );
}
