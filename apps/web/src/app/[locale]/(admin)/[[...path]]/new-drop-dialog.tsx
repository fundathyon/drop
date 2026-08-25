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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icon } from "@/components/icon";
import { useCloseOnSuccess } from "@/hooks/use-close-on-success";
import { createDropAction } from "./actions";
import { Dropzone } from "./dropzone";

export function NewDropDialog({ parent, owner }: { parent: string; owner?: number }) {
  const t = useTranslations("explorer");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createDropAction, undefined);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Icon name="package-plus" className="size-4" />
          {t("newDrop")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{t("newDropDialog.title")}</DialogTitle>
            <DialogDescription>{t("newDropDialog.description")}</DialogDescription>
          </DialogHeader>
          <input type="hidden" name="parent" value={parent} />
          {owner ? <input type="hidden" name="owner" value={owner} /> : null}
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-drop-name">{t("newDropDialog.nameLabel")}</Label>
              <Input
                id="new-drop-name"
                name="name"
                placeholder={t("newDropDialog.namePlaceholder")}
                required
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-drop-title">{t("newDropDialog.titleLabel")}</Label>
              <Input id="new-drop-title" name="title" placeholder={t("newDropDialog.titlePlaceholder")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-drop-visibility">{t("newDropDialog.visibilityLabel")}</Label>
              <Select name="visibility" defaultValue="public">
                <SelectTrigger id="new-drop-visibility" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">{t("newDropDialog.visibilityPrivate")}</SelectItem>
                  <SelectItem value="unlisted">{t("newDropDialog.visibilityUnlisted")}</SelectItem>
                  <SelectItem value="public">{t("newDropDialog.visibilityPublic")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-drop-entrypoint">{t("newDropDialog.entrypointLabel")}</Label>
              <Input id="new-drop-entrypoint" name="entrypoint" placeholder={t("newDropDialog.entrypointPlaceholder")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-drop-files">{t("newDropDialog.filesLabel")}</Label>
              <Dropzone id="new-drop-files" name="files" />
            </div>
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
