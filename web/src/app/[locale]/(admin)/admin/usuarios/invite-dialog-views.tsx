"use client";

// The form and the one-time link reveal, split out from invite-dialog.tsx as
// plain presentational components (state passed in as props, nothing read
// from useActionState directly). That keeps this file free of any runtime
// import from "./actions" — only a type is imported below, and type-only
// imports are erased at compile time — so component tests can render these
// two directly without dragging in the server-only chain (@/lib/api,
// @/lib/session) that the real action file pulls in.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icon } from "@/components/icon";
import type { InvitationActionState } from "./actions";

export function InviteForm({
  action,
  pending,
  error,
  onCancel,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  error?: InvitationActionState["error"];
  onCancel: () => void;
}) {
  const t = useTranslations("users");
  const tc = useTranslations("common");

  return (
    <form action={action}>
      <DialogHeader>
        <DialogTitle>{t("invite")}</DialogTitle>
        <DialogDescription>{t("inviteDialog.description")}</DialogDescription>
      </DialogHeader>
      {error && (
        <p role="alert" className="flex items-center gap-2 pt-3 text-sm text-destructive">
          <Icon name="triangle-alert" className="size-4 shrink-0" />
          {t(`inviteDialog.error.${error}`)}
        </p>
      )}
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="invite-email">{t("inviteDialog.emailLabel")}</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            placeholder={t("inviteDialog.emailPlaceholder")}
            required
            autoFocus
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="invite-role">{t("inviteDialog.roleLabel")}</Label>
          <Select name="role" defaultValue="user">
            <SelectTrigger id="invite-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">{t("inviteDialog.roleUser")}</SelectItem>
              <SelectItem value="admin">{t("inviteDialog.roleAdmin")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {t("inviteDialog.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function InviteLinkReveal({ link, onClose }: { link: string; onClose: () => void }) {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("inviteDialog.linkTitle")}</DialogTitle>
        <DialogDescription>{t("inviteDialog.linkDescription")}</DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-2 py-4">
        <Input readOnly aria-label={t("inviteDialog.linkAriaLabel")} value={link} />
        <Button type="button" variant="outline" onClick={copyLink}>
          <Icon name="copy" className="size-4" />
          {copied ? t("inviteDialog.copied") : t("inviteDialog.copy")}
        </Button>
      </div>
      <DialogFooter>
        <Button type="button" onClick={onClose}>
          {tc("close")}
        </Button>
      </DialogFooter>
    </>
  );
}
