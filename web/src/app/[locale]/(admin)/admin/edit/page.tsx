import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/session";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Icon } from "@/components/icon";
import { FileIcon } from "@/components/file-icon";
import { Link } from "@/i18n/navigation";
import { formatSize, joinPath } from "@/lib/format";
import { typeOf } from "@/lib/filetype";
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
  const rawHref = api.fileRawPath(fullPath, owner);

  const actions = (
    <>
      <Button asChild variant="outline" size="sm">
        <Link href={dropHref}>
          <Icon name="arrow-left" className="size-4" />
          {t("backToDrop")}
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={rawHref} target="_blank" rel="noreferrer">
          <Icon name="download" className="size-4" />
          {t("download")}
        </a>
      </Button>
    </>
  );

  return (
    <AdminLayout user={user} section={owner ? "shared" : undefined} actions={actions}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <FileIcon name={name} className="size-5" />
          <h1 className="truncate text-lg font-semibold">{name}</h1>
        </div>

        {!file ? (
          <p className="text-sm text-muted-foreground">{t("notFound")}</p>
        ) : (
          <>
            {file.generated && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon name="lock" className="size-4 shrink-0" />
                {t("generatedNotice")}
              </p>
            )}

            {type.editable && !file.generated && canEdit && (
              <EditorForm path={path} name={name} owner={owner} content={content ?? ""} file={file} type={type} />
            )}

            {type.editable && (file.generated || !canEdit) && (
              <Textarea
                readOnly
                defaultValue={content ?? ""}
                spellCheck={false}
                className="min-h-[60vh] resize-y font-mono text-sm"
                style={{ tabSize: 2 }}
              />
            )}

            {!type.editable && type.image && (
              // A raw file served straight from the Go API, at whatever size it
              // happens to be — next/image needs a fixed/known-remote source,
              // which doesn't fit an arbitrary uploaded image.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={rawHref} alt={name} className="max-w-full rounded-lg border" />
            )}

            {!type.editable && !type.image && (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center text-muted-foreground">
                <FileIcon name={name} className="size-8" />
                <p>
                  {type.label} · {formatSize(file.size)}
                  <br />
                  {t("unsupportedNotice")}
                </p>
                <Button asChild variant="outline" size="sm">
                  <a href={rawHref} target="_blank" rel="noreferrer">
                    <Icon name="download" className="size-4" />
                    {t("download")}
                  </a>
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
