"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

// resetDelayMs defaults to the ~1.5s the old admin.js used for its own
// copy-to-clipboard button, but stays overridable so tests don't have to
// actually wait that long to see the icon swap back.
export function CopyButton({
  text,
  ariaLabel,
  copiedAriaLabel,
  resetDelayMs = 1500,
}: {
  text: string;
  ariaLabel: string;
  copiedAriaLabel: string;
  resetDelayMs?: number;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? copiedAriaLabel : ariaLabel}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), resetDelayMs);
      }}
    >
      <Icon name={copied ? "circle-check" : "copy"} className="size-4" />
    </Button>
  );
}
