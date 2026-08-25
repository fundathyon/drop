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
import { formatDate } from "@/lib/format";
import { patchDropAction, type PatchDropState } from "./actions";
import type { DropMeta } from "@/lib/types";

export function EditMetaDialog({
  path,
  owner,
  meta,
}: {
  path: string;
  owner?: number;
  meta: DropMeta;
}) {
  const t = useTranslations("drop");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<PatchDropState | undefined, FormData>(
    (_prev, formData) => patchDropAction(path, formData, owner),
    undefined
  );

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Icon name="pencil" className="size-4" />
          {t("editMeta.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{t("editMeta.title")}</DialogTitle>
            <DialogDescription>
              {t.rich("editMeta.description", { code: (chunks) => <code>{chunks}</code> })}
            </DialogDescription>
          </DialogHeader>
          {state?.error && (
            <p role="alert" className="flex items-center gap-2 pt-3 text-sm text-destructive">
              <Icon name="triangle-alert" className="size-4 shrink-0" />
              {t(`editMeta.error.${state.error}`)}
            </p>
          )}
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-meta-title">{t("editMeta.titleLabel")}</Label>
              <Input id="edit-meta-title" name="title" defaultValue={meta.title} autoFocus />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-meta-visibility">{t("editMeta.visibilityLabel")}</Label>
              <Select name="visibility" defaultValue={meta.visibility}>
                <SelectTrigger id="edit-meta-visibility" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">{t("editMeta.visibilityPrivate")}</SelectItem>
                  <SelectItem value="unlisted">{t("editMeta.visibilityUnlisted")}</SelectItem>
                  <SelectItem value="public">{t("editMeta.visibilityPublic")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-meta-entrypoint">{t("editMeta.entrypointLabel")}</Label>
              <Input id="edit-meta-entrypoint" name="entrypoint" defaultValue={meta.entrypoint} />
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-sm text-muted-foreground">
              <dt>{t("editMeta.slugLabel")}</dt>
              <dd className="font-mono text-foreground">{meta.slug}</dd>
              <dt>{t("editMeta.createdLabel")}</dt>
              <dd>{formatDate(meta.created_at)}</dd>
              <dt>{t("editMeta.updatedLabel")}</dt>
              <dd>{formatDate(meta.updated_at)}</dd>
            </dl>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tc("saving") : tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
