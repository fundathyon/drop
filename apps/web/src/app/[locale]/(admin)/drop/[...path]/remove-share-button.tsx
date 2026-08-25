"use client";

import { useTransition } from "react";
import { X } from "lucide-react";
import { IconButton, useToast } from "@foundathyon/community-ui";
import { unshareAction } from "./actions";

// No ConfirmAction here on purpose — removing a share isn't destructive to
// the drop itself (the other person just loses their shortcut to it), same
// as the original admin.
export function RemoveShareButton({
  path,
  owner,
  userId,
  ariaLabel,
}: {
  path: string;
  owner?: number;
  userId: number;
  ariaLabel: string;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <IconButton
      type="button"
      variant="ghost"
      size="sm"
      icon={X}
      label={ariaLabel}
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await unshareAction(path, userId, owner);
          if (result?.error) toast({ title: result.error, tone: "danger" });
        })
      }
    />
  );
}
