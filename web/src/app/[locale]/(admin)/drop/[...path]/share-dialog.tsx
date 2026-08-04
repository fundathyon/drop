"use client";

import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
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
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Icon name="users" className="size-4" />
          {t("share.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("share.title", { title })}</DialogTitle>
          <DialogDescription>
            {t.rich("share.description", { b: (chunks) => <strong>{chunks}</strong> })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {shares.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("share.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shares.map((share) => (
                <li key={share.id} className="flex items-center gap-2 text-sm">
                  <Icon name="user" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {share.name} <span className="text-muted-foreground">{share.email}</span>
                  </span>
                  <Badge variant="secondary">
                    {share.access === "editor" ? t("share.accessEditor") : t("share.accessViewer")}
                  </Badge>
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
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
