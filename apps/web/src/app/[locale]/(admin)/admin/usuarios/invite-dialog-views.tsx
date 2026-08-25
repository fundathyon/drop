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
import { Copy } from "lucide-react";
import {
  Alert,
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Select,
  SelectItem,
} from "@foundathyon/community-ui";
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
        <div className="pt-3">
          <Alert tone="danger" title={t(`inviteDialog.error.${error}`)} />
        </div>
      )}
      <div className="grid gap-4 py-4">
        <FormField label={t("inviteDialog.emailLabel")}>
          <Input
            id="invite-email"
            name="email"
            type="email"
            placeholder={t("inviteDialog.emailPlaceholder")}
            required
            autoFocus
          />
        </FormField>
        <FormField label={t("inviteDialog.roleLabel")}>
          <Select name="role" defaultValue="user">
            <SelectItem value="user">{t("inviteDialog.roleUser")}</SelectItem>
            <SelectItem value="admin">{t("inviteDialog.roleAdmin")}</SelectItem>
          </Select>
        </FormField>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
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
        <Input readOnly aria-label={t("inviteDialog.linkAriaLabel")} value={link} wrapperClassName="flex-1" />
        <Button type="button" variant="secondary" onClick={copyLink} leading={<Copy />}>
          {copied ? t("inviteDialog.copied") : t("inviteDialog.copy")}
        </Button>
      </div>
      <DialogFooter>
        <Button type="button" variant="primary" onClick={onClose}>
          {tc("close")}
        </Button>
      </DialogFooter>
    </>
  );
}
