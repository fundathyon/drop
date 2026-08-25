"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTranslations } from "next-intl";

export interface ActionResult {
  error?: string;
}

// Generic "confirm, then really do it" dialog: the mutation itself is any
// Server Action bound to its arguments ahead of time — this component only
// owns the open/pending state and surfaces an error via toast if the action
// reports one instead of redirecting/revalidating.
export function ConfirmAction({
  trigger,
  title,
  description,
  action,
  destructive = true,
  confirmLabel,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  action: () => Promise<ActionResult | void>;
  destructive?: boolean;
  confirmLabel?: string;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await action();
                if (result?.error) {
                  toast.error(result.error);
                  return;
                }
                setOpen(false);
              });
            }}
          >
            {pending ? t("deleting") : (confirmLabel ?? t("delete"))}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
