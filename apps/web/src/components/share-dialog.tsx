"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { User, Users } from "lucide-react";
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
  Icon,
  RoleBadge,
  Text,
} from "@foundathyon/community-ui";
import { RemoveShareButton } from "@/components/remove-share-button";
import { AddShareForm } from "@/components/add-share-form";
import type { ShareInfo, UserInfo } from "@/lib/types";

/**
 * Who has access to one node, and the form to give it to someone else.
 *
 * The node is a folder or a drop — the API grants access to either, and a
 * grant on a folder reaches everything under it, including what is created
 * afterwards. `kind` only picks which of the two descriptions to show; the
 * mechanics are identical, which is why one dialog serves the explorer and the
 * drop page alike.
 */
export function ShareDialog({
  path,
  owner,
  name,
  kind,
  shares,
  candidates,
}: {
  path: string;
  owner?: number;
  name: string;
  kind: "folder" | "drop";
  shares: ShareInfo[];
  candidates: UserInfo[];
}) {
  const t = useTranslations("sharing");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm" leading={<Users />}>
            {t("trigger")}
          </Button>
        }
      />
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("title", { name })}</DialogTitle>
          <DialogDescription>
            {t.rich(kind === "folder" ? "descriptionFolder" : "descriptionDrop", {
              b: (chunks) => <strong>{chunks}</strong>,
            })}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3 py-2">
          {shares.length === 0 ? (
            <Text tone="muted">{t("empty")}</Text>
          ) : (
            <ul className="flex flex-col gap-2">
              {shares.map((share) => (
                <li key={share.id} className="flex items-center gap-2 text-sm">
                  <Icon icon={User} size={14} className="text-text-muted shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {share.name} <span className="text-text-muted">{share.email}</span>
                  </span>
                  <RoleBadge role={share.access === "editor" ? "editor" : "viewer"}>
                    {share.access === "editor" ? t("accessEditor") : t("accessViewer")}
                  </RoleBadge>
                  <RemoveShareButton
                    path={path}
                    owner={owner}
                    userId={share.user_id}
                    ariaLabel={t("removeAriaLabel", { email: share.email })}
                  />
                </li>
              ))}
            </ul>
          )}

          <AddShareForm path={path} owner={owner} candidates={candidates} />
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {tc("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
