"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
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
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={ariaLabel}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await unshareAction(path, userId, owner);
          if (result?.error) toast.error(result.error);
        })
      }
    >
      <Icon name="x" className="size-4" />
    </Button>
  );
}
