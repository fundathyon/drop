"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog, useToast } from "@foundathyon/community-ui";

export interface ActionResult {
  error?: string;
}

// Generic "confirm, then really do it" dialog: the mutation itself is any
// Server Action bound to its arguments ahead of time — this component only
// owns the pending state and surfaces an error via toast if the action reports
// one instead of redirecting/revalidating.
//
// ConfirmDialog keeps itself open when onConfirm rejects, which is exactly the
// behavior we want for a failed action, so a reported error is re-thrown rather
// than swallowed: the toast explains it and the dialog stays put so the user
// can retry or cancel.
export function ConfirmAction({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  action,
  destructive = true,
  confirmLabel,
}: {
  /**
   * Omit to drive the dialog from outside with `open`. A context-menu item
   * cannot be the trigger: the menu unmounts its items as it closes, which
   * would take the dialog's trigger — and with it the dialog — down with it.
   */
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description: string;
  action: () => Promise<ActionResult | void>;
  destructive?: boolean;
  confirmLabel?: string;
}) {
  const t = useTranslations("common");
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  return (
    <ConfirmDialog
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      verb={confirmLabel ?? t("delete")}
      tone={destructive ? "danger" : "neutral"}
      cancelLabel={t("cancel")}
      onConfirm={() =>
        new Promise<void>((resolve, reject) => {
          startTransition(async () => {
            const result = await action();
            if (result?.error) {
              toast({ title: result.error, tone: "danger" });
              reject(new Error(result.error));
              return;
            }
            resolve();
          });
        })
      }
    />
  );
}
