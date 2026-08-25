"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import {
  Alert,
  Button,
  DescriptionList,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  FormField,
  Input,
  Select,
  SelectItem,
  Separator,
} from "@foundathyon/community-ui";
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
  const [visibility, setVisibility] = useState<string | null>(meta.visibility);
  const [state, action, pending] = useActionState<PatchDropState | undefined, FormData>(
    (_prev, formData) => patchDropAction(path, formData, owner),
    undefined
  );

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm" leading={<Pencil />}>
            {t("editMeta.trigger")}
          </Button>
        }
      />
      <DialogContent size="md">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{t("editMeta.title")}</DialogTitle>
            <DialogDescription>
              {t.rich("editMeta.description", { code: (chunks) => <code>{chunks}</code> })}
            </DialogDescription>
          </DialogHeader>
          {state?.error && (
            <div className="pt-3">
              <Alert tone="danger" title={t(`editMeta.error.${state.error}`)} />
            </div>
          )}
          <DialogBody className="grid gap-4 py-4">
            <FormField label={t("editMeta.titleLabel")}>
              <Input id="edit-meta-title" name="title" defaultValue={meta.title} autoFocus />
            </FormField>
            <FormField label={t("editMeta.visibilityLabel")}>
              <Select name="visibility" value={visibility} onValueChange={setVisibility}>
                <SelectItem value="private">{t("editMeta.visibilityPrivate")}</SelectItem>
                <SelectItem value="unlisted">{t("editMeta.visibilityUnlisted")}</SelectItem>
                <SelectItem value="public">{t("editMeta.visibilityPublic")}</SelectItem>
              </Select>
            </FormField>
            <FormField label={t("editMeta.entrypointLabel")}>
              <Input id="edit-meta-entrypoint" name="entrypoint" defaultValue={meta.entrypoint} />
            </FormField>
            <Separator />
            <DescriptionList
              items={[
                // `mono` on the slug only: it is meant to be copied and compared
                // character by character (§03), unlike the two dates.
                { label: t("editMeta.slugLabel"), value: meta.slug, mono: true },
                { label: t("editMeta.createdLabel"), value: formatDate(meta.created_at) },
                { label: t("editMeta.updatedLabel"), value: formatDate(meta.updated_at) },
              ]}
            />
          </DialogBody>
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
