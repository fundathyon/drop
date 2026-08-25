"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { FolderPlus } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  FormField,
  Input,
} from "@foundathyon/community-ui";
import { useCloseOnSuccess } from "@/hooks/use-close-on-success";
import { createFolderAction } from "./actions";

export function NewFolderDialog({ parent, owner }: { parent: string; owner?: number }) {
  const t = useTranslations("explorer");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createFolderAction, undefined);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm" leading={<FolderPlus />}>
            {t("newFolder")}
          </Button>
        }
      />
      <DialogContent size="sm">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{t("newFolderDialog.title")}</DialogTitle>
            <DialogDescription>{t("newFolderDialog.description")}</DialogDescription>
          </DialogHeader>
          <input type="hidden" name="parent" value={parent} />
          {owner ? <input type="hidden" name="owner" value={owner} /> : null}
          <div className="py-4">
            <FormField label={t("newFolderDialog.nameLabel")}>
              <Input
                id="new-folder-name"
                name="name"
                placeholder={t("newFolderDialog.namePlaceholder")}
                required
                autoFocus
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {tc("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
