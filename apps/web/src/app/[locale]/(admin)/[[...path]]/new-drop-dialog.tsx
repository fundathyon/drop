"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { PackagePlus } from "lucide-react";
import {
  Button,
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
} from "@foundathyon/community-ui";
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
      <DialogTrigger
        render={
          <Button variant="primary" size="sm" leading={<PackagePlus />}>
            {t("newDrop")}
          </Button>
        }
      />
      <DialogContent size="md">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{t("newDropDialog.title")}</DialogTitle>
            <DialogDescription>{t("newDropDialog.description")}</DialogDescription>
          </DialogHeader>
          <input type="hidden" name="parent" value={parent} />
          {owner ? <input type="hidden" name="owner" value={owner} /> : null}
          {/* Five fields plus a dropzone is past what a Dialog holds without
              scrolling (§13), so the middle region scrolls instead of the page. */}
          <DialogBody className="grid gap-4 py-4">
            <FormField label={t("newDropDialog.nameLabel")}>
              <Input
                id="new-drop-name"
                name="name"
                placeholder={t("newDropDialog.namePlaceholder")}
                required
                autoFocus
              />
            </FormField>
            <FormField label={t("newDropDialog.titleLabel")}>
              <Input id="new-drop-title" name="title" placeholder={t("newDropDialog.titlePlaceholder")} />
            </FormField>
            <FormField label={t("newDropDialog.visibilityLabel")}>
              <Select name="visibility" defaultValue="public">
                <SelectItem value="private">{t("newDropDialog.visibilityPrivate")}</SelectItem>
                <SelectItem value="unlisted">{t("newDropDialog.visibilityUnlisted")}</SelectItem>
                <SelectItem value="public">{t("newDropDialog.visibilityPublic")}</SelectItem>
              </Select>
            </FormField>
            <FormField label={t("newDropDialog.entrypointLabel")}>
              <Input
                id="new-drop-entrypoint"
                name="entrypoint"
                placeholder={t("newDropDialog.entrypointPlaceholder")}
              />
            </FormField>
            <FormField label={t("newDropDialog.filesLabel")}>
              <Dropzone id="new-drop-files" name="files" />
            </FormField>
          </DialogBody>
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
