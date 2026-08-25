"use client";

import { useState } from "react";
import { CircleCheck, Copy } from "lucide-react";
import { IconButton } from "@foundathyon/community-ui";

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
    <IconButton
      type="button"
      variant="ghost"
      size="sm"
      icon={copied ? CircleCheck : Copy}
      label={copied ? copiedAriaLabel : ariaLabel}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), resetDelayMs);
      }}
    />
  );
}
