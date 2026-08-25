"use client";

import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@foundathyon/community-ui";
import { ConfirmAction } from "@/components/confirm-action";
import { deleteDropAction } from "./actions";

export function DeleteDropButton({ path, owner }: { path: string; owner?: number }) {
  const t = useTranslations("drop");

  return (
    <ConfirmAction
      trigger={
        // destructive-subtle, not destructive: §09 reserves the solid
        // destructive button for the final confirmation inside the dialog.
        <Button variant="destructive-subtle" size="sm" leading={<Trash2 />}>
          {t("deleteDrop.trigger")}
        </Button>
      }
      title={t("deleteDrop.title")}
      description={t("deleteDrop.description")}
      action={() => deleteDropAction(path, owner)}
    />
  );
}
