"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  FormField,
} from "@foundathyon/community-ui";
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
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm" leading={<Upload />}>
            {t("upload.trigger")}
          </Button>
        }
      />
      <DialogContent size="sm">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{t("upload.title")}</DialogTitle>
            <DialogDescription>{t("upload.description")}</DialogDescription>
          </DialogHeader>
          {state?.error && (
            <div className="pt-3">
              <Alert tone="danger" title={t(`upload.error.${state.error}`)} />
            </div>
          )}
          <div className="py-4">
            {/* Still the native input: the surrounding <form action> reads
                `file` straight off the FormData, and swapping in a controlled
                uploader would mean mirroring its FileList by hand for no gain
                at this size. */}
            <FormField label={t("upload.fileLabel")}>
              <input
                id="upload-file"
                type="file"
                name="file"
                multiple
                required
                className="border-border-strong bg-surface text-text w-full rounded-md border px-2.5 py-1.5 text-sm"
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {pending ? tc("saving") : tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
