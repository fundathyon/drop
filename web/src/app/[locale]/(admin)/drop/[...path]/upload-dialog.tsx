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
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { useCloseOnSuccess } from "@/hooks/use-close-on-success";
import { uploadFilesAction, type UploadFilesState } from "./actions";

export function UploadDialog({ path, owner }: { path: string; owner?: number }) {
  const t = useTranslations("drop");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<UploadFilesState | undefined, FormData>(
    (_prev, formData) => uploadFilesAction(path, formData, owner),
    undefined
  );

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Icon name="upload" className="size-4" />
          {t("upload.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{t("upload.title")}</DialogTitle>
            <DialogDescription>{t("upload.description")}</DialogDescription>
          </DialogHeader>
          {state?.error && (
            <p role="alert" className="flex items-center gap-2 pt-3 text-sm text-destructive">
              <Icon name="triangle-alert" className="size-4 shrink-0" />
              {t(`upload.error.${state.error}`)}
            </p>
          )}
          <div className="grid gap-2 py-4">
            <Label htmlFor="upload-file">{t("upload.fileLabel")}</Label>
            <input
              id="upload-file"
              type="file"
              name="file"
              multiple
              required
              className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm"
            />
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
