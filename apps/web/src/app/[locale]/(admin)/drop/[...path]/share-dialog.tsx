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
import { RemoveShareButton } from "./remove-share-button";
import { AddShareForm } from "./add-share-form";
import type { ShareInfo, UserInfo } from "@/lib/types";

export function ShareDialog({
  path,
  owner,
  title,
  shares,
  candidates,
}: {
  path: string;
  owner?: number;
  title: string;
  shares: ShareInfo[];
  candidates: UserInfo[];
}) {
  const t = useTranslations("drop");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm" leading={<Users />}>
            {t("share.trigger")}
          </Button>
        }
      />
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("share.title", { title })}</DialogTitle>
          <DialogDescription>
            {t.rich("share.description", { b: (chunks) => <strong>{chunks}</strong> })}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3 py-2">
          {shares.length === 0 ? (
            <Text tone="muted">{t("share.empty")}</Text>
          ) : (
            <ul className="flex flex-col gap-2">
              {shares.map((share) => (
                <li key={share.id} className="flex items-center gap-2 text-sm">
                  <Icon icon={User} size={14} className="text-text-muted shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {share.name} <span className="text-text-muted">{share.email}</span>
                  </span>
                  <RoleBadge role={share.access === "editor" ? "editor" : "viewer"}>
                    {share.access === "editor" ? t("share.accessEditor") : t("share.accessViewer")}
                  </RoleBadge>
                  <RemoveShareButton
                    path={path}
                    owner={owner}
                    userId={share.user_id}
                    ariaLabel={t("share.removeAriaLabel", { email: share.email })}
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
