"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, Button, FormField, Select, SelectItem, Separator } from "@foundathyon/community-ui";
import { shareAction, type ShareState } from "./actions";
import type { UserInfo } from "@/lib/types";

// Deliberately not using useCloseOnSuccess: the original keeps this dialog
// open after a share so you can add more people. A successful submit just
// needs the fields back to a blank slate, while the shares list above updates
// on its own once the action's revalidatePath takes effect.
//
// The reset is a remount, not a `form.reset()`: Base UI's Select keeps its
// value in React state, so a native reset would put the hidden input back but
// leave the trigger showing the previous label. Bumping the key throws both
// fields away and rebuilds them at their defaults, which covers the native
// inputs and the Selects with one mechanism. The counter is adjusted during
// render (the documented "derive state from a changed prop" pattern) rather
// than in an effect, so there is no second render pass to observe.
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
  const [state, action, pending] = useActionState<ShareState | undefined, FormData>(
    (_prev, formData) => shareAction(path, formData, owner),
    undefined
  );
  const [seenState, setSeenState] = useState(state);
  const [resetKey, setResetKey] = useState(0);

  if (state !== seenState) {
    setSeenState(state);
    if (state && !state.error) setResetKey((k) => k + 1);
  }

  return (
    <form action={action} className="grid gap-3">
      <Separator />
      <div key={resetKey} className="grid gap-3">
        <FormField label={t("share.personLabel")}>
          <Select
            name="user_id"
            placeholder={t("share.personPlaceholder")}
            items={candidates.map((candidate) => ({
              value: String(candidate.id),
              label: `${candidate.name} — ${candidate.email}`,
            }))}
          />
        </FormField>
        <FormField label={t("share.accessLabel")}>
          <Select name="access" defaultValue="viewer">
            <SelectItem value="viewer">{t("share.accessViewerOption")}</SelectItem>
            <SelectItem value="editor">{t("share.accessEditorOption")}</SelectItem>
          </Select>
        </FormField>
      </div>
      {state?.error && <Alert tone="danger" title={t(`share.error.${state.error}`)} />}
      <Button type="submit" variant="primary" loading={pending} className="justify-self-start">
        {pending ? t("share.sharing") : t("share.submit")}
      </Button>
    </form>
  );
}
