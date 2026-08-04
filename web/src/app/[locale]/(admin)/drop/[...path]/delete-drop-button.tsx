"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { ConfirmAction } from "@/components/confirm-action";
import { deleteDropAction } from "./actions";

export function DeleteDropButton({ path, owner }: { path: string; owner?: number }) {
  const t = useTranslations("drop");

  return (
    <ConfirmAction
      trigger={
        <Button variant="destructive" size="sm">
          <Icon name="trash-2" className="size-4" />
          {t("deleteDrop.trigger")}
        </Button>
      }
      title={t("deleteDrop.title")}
      description={t("deleteDrop.description")}
      action={() => deleteDropAction(path, owner)}
    />
  );
}
