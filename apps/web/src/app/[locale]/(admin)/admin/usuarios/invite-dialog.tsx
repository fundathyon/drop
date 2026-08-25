"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Mail } from "lucide-react";
import { Button, Dialog, DialogContent, DialogTrigger } from "@foundathyon/community-ui";
import { createInvitationAction } from "./actions";
import { InviteForm, InviteLinkReveal } from "./invite-dialog-views";

// The invitation link is only ever available for the render right after a
// successful create — it can't be fetched again later. Once the dialog is
// closed, the next open must start from a blank form rather than showing the
// previous invite's (now one-time-seen) link, so the whole body is remounted
// under a fresh key on every close.
export function InviteDialog() {
  const t = useTranslations("users");
  const [open, setOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setSessionKey((k) => k + 1);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="primary" size="sm" leading={<Mail />}>
            {t("invite")}
          </Button>
        }
      />
      <DialogContent size="sm">
        <InviteDialogBody key={sessionKey} onClose={() => handleOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function InviteDialogBody({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(createInvitationAction, undefined);

  if (state?.link) {
    return <InviteLinkReveal link={state.link} onClose={onClose} />;
  }
  return <InviteForm action={action} pending={pending} error={state?.error} onCancel={onClose} />;
}
