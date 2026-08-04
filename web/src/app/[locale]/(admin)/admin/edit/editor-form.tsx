"use client";

import { useActionState, useRef } from "react";
import { useTranslations } from "next-intl";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { Link } from "@/i18n/navigation";
import { formatDate, formatSize } from "@/lib/format";
import { computeTabKeyDown } from "./tab-behavior";
import { saveFileAction, type SaveFileState } from "./actions";
import type { FileInfo } from "@/lib/types";
import type { FileType } from "@/lib/filetype";

export function EditorForm({
  path,
  name,
  owner,
  content,
  file,
  type,
}: {
  path: string;
  name: string;
  owner?: number;
  content: string;
  file: FileInfo;
  type: FileType;
}) {
  const t = useTranslations("editor");
  const tc = useTranslations("common");
  const escapedRef = useRef(false);
  const [state, action, pending] = useActionState<SaveFileState | undefined, FormData>(
    (_prev, formData) => saveFileAction(path, name, formData, owner),
    undefined
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <Textarea
        name="content"
        defaultValue={content}
        spellCheck={false}
        className="min-h-[60vh] resize-y font-mono text-sm"
        style={{ tabSize: 2 }}
        onKeyDown={(event) => {
          const target = event.currentTarget;
          const result = computeTabKeyDown(
            {
              key: event.key,
              value: target.value,
              selectionStart: target.selectionStart,
              selectionEnd: target.selectionEnd,
            },
            escapedRef.current
          );
          escapedRef.current = result.escaped;
          if (result.handled && result.value !== undefined) {
            event.preventDefault();
            target.value = result.value;
            target.selectionStart = target.selectionEnd = result.selectionStart ?? target.selectionStart;
          }
        }}
      />
      {state?.error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <Icon name="triangle-alert" className="size-4 shrink-0" />
          {t(`error.${state.error}`)}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {type.label} · {formatSize(file.size)} · {formatDate(file.modified_at)}
        </span>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/drop/${path}${owner ? `?owner=${owner}` : ""}`}>{tc("cancel")}</Link>
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            <Icon name="save" className="size-4" />
            {pending ? tc("saving") : tc("save")}
          </Button>
        </div>
      </div>
    </form>
  );
}
