import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/session";
import { api } from "@/lib/api";
import { AdminLayout, type Crumb } from "@/components/admin-layout";
import { Icon } from "@/components/icon";
import { FileIcon } from "@/components/file-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { decodePathSegments, formatDate, formatSize, joinPath } from "@/lib/format";
import { typeOf } from "@/lib/filetype";
import { CopyButton } from "./copy-button";
import { DeleteDropButton } from "./delete-drop-button";
import { DeleteFileButton } from "./delete-file-button";
import { RestoreVersionButton } from "./restore-version-button";
import { EditMetaDialog } from "./edit-meta-dialog";
import { UploadDialog } from "./upload-dialog";
import { ShareDialog } from "./share-dialog";

function ownerQuery(owner?: number) {
  return owner ? `?owner=${owner}` : "";
}

function editHref(path: string, owner: number | undefined, name: string) {
  const q = new URLSearchParams({ path, name });
  if (owner) q.set("owner", String(owner));
  return `/admin/edit?${q.toString()}`;
}

function buildCrumbs(path: string, title: string, owner?: number): Crumb[] {
  const parts = path.split("/").filter(Boolean);
  let acc = "";
  return parts.map((name, i) => {
    acc = acc ? `${acc}/${name}` : name;
    const isLast = i === parts.length - 1;
    return {
      name: isLast ? title : name,
      href: isLast ? `/drop/${path}${ownerQuery(owner)}` : `/${acc}${ownerQuery(owner)}`,
    };
  });
}

export default async function DropPage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ owner?: string }>;
}) {
  const user = await requireUser();
  const { path: pathSegments } = await params;
  const { owner: ownerParam } = await searchParams;
  const path = decodePathSegments(pathSegments);
  const owner = ownerParam ? Number(ownerParam) : undefined;

  const detail = await api.getDrop(path, owner);
  const canEdit = detail.access === "owner" || detail.access === "editor";
  const canShare = detail.access !== "viewer";
  const shareData = canShare ? await api.listShares(path, owner) : null;

  const t = await getTranslations("drop");

  const actions = (
    <>
      {canShare && shareData && (
        <ShareDialog
          path={path}
          owner={owner}
          title={detail.meta.title}
          shares={shareData.shares}
          candidates={shareData.candidates}
        />
      )}
      {canEdit && (
        <>
          <EditMetaDialog path={path} owner={owner} meta={detail.meta} />
          <UploadDialog path={path} owner={owner} />
        </>
      )}
      {detail.access === "owner" && <DeleteDropButton path={path} owner={owner} />}
    </>
  );

  return (
    <AdminLayout
      user={user}
      section={owner ? "shared" : undefined}
      crumbs={buildCrumbs(path, detail.meta.title, owner)}
      actions={actions}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <Badge variant="secondary">v{detail.meta.version}</Badge>
          <Badge variant="secondary">{detail.meta.visibility}</Badge>
        </div>

        {!detail.entrypoint_missing && (
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span title={detail.meta.visibility === "private" ? t("openTitleLocked") : t("openTitleExternal")}>
              <Icon
                name={detail.meta.visibility === "private" ? "lock" : "external-link"}
                className="size-4 shrink-0 text-muted-foreground"
              />
            </span>
            <a
              href={detail.url}
              target="_blank"
              rel="noreferrer"
              className="truncate underline-offset-2 hover:underline"
            >
              {detail.url}
            </a>
            <CopyButton text={detail.url} ariaLabel={t("copyAriaLabel")} copiedAriaLabel={t("copiedAriaLabel")} />
          </div>
        )}

        {detail.meta.visibility === "private" && !detail.entrypoint_missing && (
          <Alert>
            <Icon name="lock" className="size-4" />
            <AlertDescription>
              <p>{t.rich("notices.privateLine1", { b: (chunks) => <strong>{chunks}</strong> })}</p>
              <p>
                {canEdit
                  ? t.rich("notices.privateLine2Owner", {
                      b: (chunks) => <strong>{chunks}</strong>,
                      code: (chunks) => <code>{chunks}</code>,
                    })
                  : t("notices.privateLine2Other")}
              </p>
            </AlertDescription>
          </Alert>
        )}

        {detail.access !== "owner" && (
          <Alert>
            <Icon name="users" className="size-4" />
            <AlertDescription>
              <p>
                {t.rich("notices.sharedLine1", {
                  access:
                    detail.access === "editor" ? t("notices.sharedAccessEditor") : t("notices.sharedAccessViewer"),
                  b: (chunks) => <strong>{chunks}</strong>,
                })}
              </p>
              <p>{detail.access === "editor" ? t("notices.sharedLine2Editor") : t("notices.sharedLine2Viewer")}</p>
            </AlertDescription>
          </Alert>
        )}

        {detail.entrypoint_missing && (
          <Alert variant="destructive">
            <Icon name="triangle-alert" className="size-4" />
            <AlertDescription>
              {t.rich("notices.entrypointMissing", {
                entrypoint: detail.meta.entrypoint,
                b: (chunks) => <strong>{chunks}</strong>,
                code: (chunks) => <code>{chunks}</code>,
              })}
            </AlertDescription>
          </Alert>
        )}

        {detail.files.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-muted-foreground">
            <Icon name="file-text" className="size-8" />
            <p>{t("empty")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("files.nameHeader")}</TableHead>
                  <TableHead>{t("files.typeHeader")}</TableHead>
                  <TableHead>{t("files.sizeHeader")}</TableHead>
                  <TableHead>{t("files.modifiedHeader")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.files.map((file) => (
                  <TableRow key={file.name}>
                    <TableCell>
                      <a href={editHref(path, owner, file.name)} className="flex items-center gap-2">
                        <FileIcon name={file.name} />
                        {file.name}
                        {file.generated && (
                          <span title={t("files.generatedTitle")}>
                            <Icon name="lock" className="size-3.5 text-muted-foreground" />
                          </span>
                        )}
                      </a>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{typeOf(file.name).label}</Badge>
                    </TableCell>
                    <TableCell>{formatSize(file.size)}</TableCell>
                    <TableCell>{formatDate(file.modified_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="icon" aria-label={t("files.downloadAriaLabel", { name: file.name })}>
                          <a href={api.fileRawPath(joinPath(path, file.name), owner)} target="_blank" rel="noreferrer">
                            <Icon name="download" className="size-4" />
                          </a>
                        </Button>
                        {!file.generated && canEdit && (
                          <DeleteFileButton fullPath={joinPath(path, file.name)} owner={owner} name={file.name} />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {detail.versions.length > 1 && (
          <div className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{t("versions.subtitle")}</h2>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableBody>
                  {detail.versions.map((version) => (
                    <TableRow key={version.seq}>
                      <TableCell className="font-medium">v{version.seq}</TableCell>
                      <TableCell>{version.current && <Badge variant="secondary">{t("versions.current")}</Badge>}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {t("versions.filesCount", { count: version.files })} · {formatSize(version.size)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(version.published_at)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button asChild variant="ghost" size="sm" aria-label={t("versions.viewAriaLabel", { seq: version.seq })}>
                            <a href={version.url} target="_blank" rel="noreferrer">
                              <Icon name="external-link" className="size-4" />
                              {t("versions.view")}
                            </a>
                          </Button>
                          {!version.current && canEdit && (
                            <RestoreVersionButton path={path} owner={owner} seq={version.seq} />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
