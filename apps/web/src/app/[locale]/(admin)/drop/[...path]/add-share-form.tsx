"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icon } from "@/components/icon";
import { shareAction, type ShareState } from "./actions";
import type { UserInfo } from "@/lib/types";

// Deliberately not using useCloseOnSuccess: the original keeps this dialog
// open after a share so you can add more people. A successful submit just
// needs the fields back to a blank slate, while the shares list above updates
// on its own once the action's revalidatePath takes effect. Resetting is a
// real side effect on the native <form> element (not a mirror of one React
// state into another), so it belongs in an effect rather than the render-body
// setState trick useCloseOnSuccess uses — Radix's Select listens for the
// form's native "reset" event to put itself back to its own default, so
// nothing here needs to reach into the select components directly.
export function AddShareForm({
  path,
  owner,
  candidates,
}: {
  path: string;
  owner?: number;
  candidates: UserInfo[];
}) {
  const t = useTranslations("drop");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ShareState | undefined, FormData>(
    (_prev, formData) => shareAction(path, formData, owner),
    undefined
  );

  useEffect(() => {
    if (state && !state.error) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="grid gap-3 border-t pt-3">
      <div className="grid gap-2">
        <Label htmlFor="share-person">{t("share.personLabel")}</Label>
        <Select name="user_id">
          <SelectTrigger id="share-person" className="w-full">
            <SelectValue placeholder={t("share.personPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((candidate) => (
              <SelectItem key={candidate.id} value={String(candidate.id)}>
                {candidate.name} — {candidate.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="share-access">{t("share.accessLabel")}</Label>
        <Select name="access" defaultValue="viewer">
          <SelectTrigger id="share-access" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="viewer">{t("share.accessViewerOption")}</SelectItem>
            <SelectItem value="editor">{t("share.accessEditorOption")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {state?.error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <Icon name="triangle-alert" className="size-4 shrink-0" />
          {t(`share.error.${state.error}`)}
        </p>
      )}
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? t("share.sharing") : t("share.submit")}
      </Button>
    </form>
  );
}
