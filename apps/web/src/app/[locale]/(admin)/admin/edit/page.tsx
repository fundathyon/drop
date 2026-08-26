import { getTranslations } from "next-intl/server";
import { ArrowLeft, Download, Lock } from "lucide-react";
import { Heading, Icon, Text } from "@foundathyon/community-ui";
import { requireUser } from "@/lib/session";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { FileIcon } from "@/components/file-icon";
import { DocumentIcon } from "@/components/finder-icon";
import { LinkButton } from "@/components/link-button";
import { formatSize, joinPath } from "@/lib/format";
import { typeOf } from "@/lib/filetype";
import { CodeEditor } from "@/components/code-editor";
import { EditorForm } from "./editor-form";

export default async function EditFilePage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string; name?: string; owner?: string }>;
}) {
  const user = await requireUser();
  const { path: pathParam, name: nameParam, owner: ownerParam } = await searchParams;
  const path = pathParam ?? "";
  const name = nameParam ?? "";
  const owner = ownerParam ? Number(ownerParam) : undefined;
  const fullPath = joinPath(path, name);

  const detail = await api.getDrop(path, owner);
  const file = detail.files.find((f) => f.name === name);
  const type = typeOf(name);
  const canEdit = detail.access === "owner" || detail.access === "editor";
  const content = type.editable ? await api.downloadFileText(fullPath, owner) : undefined;

  const t = await getTranslations("editor");

  const dropHref = `/drop/${path}${owner ? `?owner=${owner}` : ""}`;
  // Only the branch that actually shows an editor earns the full width. The
  // "not found" line, the image preview and the unsupported-type card are all
  // small, centred things that would just be stretched by it.
  const showsEditor = Boolean(file && type.editable);
  const rawHref = api.fileRawPath(fullPath, owner);

  const actions = (
    <>
      <LinkButton href={dropHref}>
        <ArrowLeft className="size-3.5" />
        {t("backToDrop")}
      </LinkButton>
      <LinkButton href={rawHref} external>
        <Download className="size-3.5" />
        {t("download")}
      </LinkButton>
    </>
  );

  return (
    <AdminLayout user={user} section={owner ? "shared" : undefined} actions={actions} wide={showsEditor}>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-center gap-2">
          <FileIcon name={name} className="size-5" />
          <Heading level={1} className="truncate">
            {name}
          </Heading>
        </div>

        {!file ? (
          <Text tone="muted">{t("notFound")}</Text>
        ) : (
          <>
            {file.generated && (
              <Text tone="muted" className="flex items-center gap-2">
                <Icon icon={Lock} size={14} />
                {t("generatedNotice")}
              </Text>
            )}

            {type.editable && !file.generated && canEdit && (
              <EditorForm path={path} name={name} owner={owner} content={content ?? ""} file={file} type={type} />
            )}

            {/* Same editor, no write access: a file you may not change should
                still be as readable as one you may — same highlighting, same
                search, same folding. */}
            {type.editable && (file.generated || !canEdit) && (
              <CodeEditor
                readOnly
                value={content ?? ""}
                language={type.monaco}
                path={name}
                ariaLabel={t("editorAriaLabel", { name })}
                className="min-h-80 flex-1"
              />
            )}

            {!type.editable && type.image && (
              // A raw file served straight from the Go API, at whatever size it
              // happens to be — next/image needs a fixed/known-remote source,
              // which doesn't fit an arbitrary uploaded image.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={rawHref} alt={name} className="border-border max-w-full rounded-lg border" />
            )}

            {!type.editable && !type.image && (
              // Not an EmptyState: nothing is missing here — the file exists and
              // we simply can't render it (§11 keeps those apart). The document
              // artwork does the explaining, at the size it was drawn for.
              <div className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
                <DocumentIcon name={name} size={72} />
                <Text tone="muted" as="div">
                  {type.label} · {formatSize(file.size)}
                  <br />
                  {t("unsupportedNotice")}
                </Text>
                <LinkButton href={rawHref} external>
                  <Download className="size-3.5" />
                  {t("download")}
                </LinkButton>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
