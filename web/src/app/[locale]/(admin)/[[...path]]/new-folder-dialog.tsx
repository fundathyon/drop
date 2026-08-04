"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
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
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Icon name="folder-plus" className="size-4" />
          {t("newFolder")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{t("newFolderDialog.title")}</DialogTitle>
            <DialogDescription>{t("newFolderDialog.description")}</DialogDescription>
          </DialogHeader>
          <input type="hidden" name="parent" value={parent} />
          {owner ? <input type="hidden" name="owner" value={owner} /> : null}
          <div className="grid gap-2 py-4">
            <Label htmlFor="new-folder-name">{t("newFolderDialog.nameLabel")}</Label>
            <Input
              id="new-folder-name"
              name="name"
              placeholder={t("newFolderDialog.namePlaceholder")}
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {tc("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
