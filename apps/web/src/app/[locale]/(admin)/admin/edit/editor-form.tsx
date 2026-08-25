"use client";

import { useActionState, useRef } from "react";
import { useTranslations } from "next-intl";
import { Save } from "lucide-react";
import { Alert, Button, Text, Textarea } from "@foundathyon/community-ui";
import { LinkButton } from "@/components/link-button";
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
      {state?.error && <Alert tone="danger" title={t(`error.${state.error}`)} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text variant="body-sm" tone="muted" tabular>
          {type.label} · {formatSize(file.size)} · {formatDate(file.modified_at)}
        </Text>
        <div className="flex items-center gap-2">
          <LinkButton href={`/drop/${path}${owner ? `?owner=${owner}` : ""}`}>{tc("cancel")}</LinkButton>
          <Button type="submit" variant="primary" size="sm" loading={pending} leading={<Save />}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </div>
      </div>
    </form>
  );
}
