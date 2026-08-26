"use client";

import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Save } from "lucide-react";
import { Alert, Badge, Button, ConfirmDialog, Kbd, Text } from "@foundathyon/community-ui";
import { LinkButton } from "@/components/link-button";
import { useRouter } from "@/i18n/navigation";
import { CodeEditor, type CursorPosition } from "@/components/code-editor";
import { formatDate, formatSize } from "@/lib/format";
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
  const router = useRouter();
  const [state, action, pending] = useActionState<SaveFileState | undefined, FormData>(
    (_prev, formData) => saveFileAction(path, name, formData, owner),
    undefined
  );

  const dropHref = `/drop/${path}${owner ? `?owner=${owner}` : ""}`;

  // The editor owns the text; React only needs the latest copy to submit, so
  // it lives in a ref and no keystroke causes a render.
  const draft = useRef(content);
  // What the server currently holds. `dirty` is the comparison between the
  // two, which is why undoing back to the original clears the badge instead of
  // leaving it stuck on.
  const saved = useRef(content);
  const submitted = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1, lines: 1 });
  const [leaving, setLeaving] = useState(false);

  const submit = useCallback(() => {
    if (draft.current === saved.current) return;
    submitted.current = draft.current;
    const formData = new FormData();
    formData.set("content", draft.current);
    startTransition(() => action(formData));
  }, [action]);

  // A save only counts once the action has come back clean, and it moves the
  // baseline to the text that was SENT — not to whatever is on screen now,
  // which may already have moved on while the request was in flight.
  useEffect(() => {
    if (!state || state.error || submitted.current === null) return;
    saved.current = submitted.current;
    submitted.current = null;
    setDirty(draft.current !== saved.current);
  }, [state]);

  // Covers reloads, closing the tab and following a link out of the app.
  // In-app navigation never fires this, which is what the confirmation on
  // Cancel below is for.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <CodeEditor
        value={content}
        language={type.monaco}
        path={name}
        ariaLabel={t("editorAriaLabel", { name })}
        // Takes whatever the heading and the footer leave, rather than a
        // viewport calculation that has to be corrected every time either of
        // them changes height. min-h keeps it usable on a short window, where
        // the shell scrolls instead.
        className="min-h-80 flex-1"
        onChange={(value) => {
          draft.current = value;
          setDirty(value !== saved.current);
        }}
        onCursorChange={setCursor}
        onSave={submit}
      />

      {state?.error && <Alert tone="danger" title={t(`error.${state.error}`)} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Text variant="body-sm" tone="muted" tabular>
            {type.label} · {formatSize(file.size)} · {formatDate(file.modified_at)}
          </Text>
          <Text variant="body-sm" tone="muted" tabular>
            · {t("cursor", { line: cursor.line, column: cursor.column })} · {t("lines", { count: cursor.lines })}
          </Text>
          {dirty && (
            <Badge variant="tonal" tone="warning">
              {t("unsaved")}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Still a link (§09), and deliberately so: the confirmation only
              intercepts the plain click. Middle-click and "open in new tab"
              keep working and cost nothing, since neither leaves this page. */}
          <LinkButton
            href={dropHref}
            onClick={(event) => {
              if (!dirty) return;
              event.preventDefault();
              setLeaving(true);
            }}
          >
            {tc("cancel")}
          </LinkButton>
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={pending}
            disabled={!dirty && !pending}
            leading={<Save />}
            onClick={submit}
          >
            {pending ? tc("saving") : tc("save")}
            {/* §17: a shortcut the product owns has to be taught somewhere. */}
            {!pending && <Kbd className="ml-1">⌘S</Kbd>}
          </Button>
        </div>
      </div>

      {/* Cancel is the one way out that React Router handles itself, so
          beforeunload never sees it — this is its stand-in. */}
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title={t("discardTitle")}
        description={t("discardDescription", { name })}
        verb={t("discardVerb")}
        cancelLabel={t("keepEditing")}
        onConfirm={() => router.push(dropHref)}
      />
    </div>
  );
}
