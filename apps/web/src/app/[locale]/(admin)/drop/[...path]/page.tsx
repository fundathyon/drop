import { getTranslations } from "next-intl/server";
import { Download, ExternalLink, FileText, Lock } from "lucide-react";
import {
  Alert,
  Badge,
  EmptyState,
  Heading,
  Icon,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@foundathyon/community-ui";
import { requireUser } from "@/lib/session";
import { api } from "@/lib/api";
import { AdminLayout, type Crumb } from "@/components/admin-layout";
import { FileIcon } from "@/components/file-icon";
import { LinkButton } from "@/components/link-button";
import { QuickActions } from "@/components/quick-actions";
import { decodePathSegments, formatDate, formatSize, joinPath } from "@/lib/format";
import { typeOf } from "@/lib/filetype";
import { deleteFileAction } from "./actions";
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
          <Heading level={1}>{t("title")}</Heading>
          <Badge variant="outline" tone="neutral">
            v{detail.meta.version}
          </Badge>
          <Badge variant="tonal" tone="neutral">
            {detail.meta.visibility}
          </Badge>
        </div>

        {!detail.entrypoint_missing && (
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span title={detail.meta.visibility === "private" ? t("openTitleLocked") : t("openTitleExternal")}>
              <Icon
                icon={detail.meta.visibility === "private" ? Lock : ExternalLink}
                size={14}
                className="text-text-muted shrink-0"
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

        {/* Alert owns its icon per tone (§07), so these notices only supply the
            first line as the title and the second as the body. */}
        {detail.meta.visibility === "private" && !detail.entrypoint_missing && (
          <Alert
            tone="info"
            icon={Lock}
            title={t.rich("notices.privateLine1", { b: (chunks) => <strong>{chunks}</strong> })}
          >
            {canEdit
              ? t.rich("notices.privateLine2Owner", {
                  b: (chunks) => <strong>{chunks}</strong>,
                  code: (chunks) => <code>{chunks}</code>,
                })
              : t("notices.privateLine2Other")}
          </Alert>
        )}

        {detail.access !== "owner" && (
          <Alert
            tone="info"
            title={t.rich("notices.sharedLine1", {
              access: detail.access === "editor" ? t("notices.sharedAccessEditor") : t("notices.sharedAccessViewer"),
              b: (chunks) => <strong>{chunks}</strong>,
            })}
          >
            {detail.access === "editor" ? t("notices.sharedLine2Editor") : t("notices.sharedLine2Viewer")}
          </Alert>
        )}

        {detail.entrypoint_missing && (
          <Alert
            tone="danger"
            title={t.rich("notices.entrypointMissing", {
              entrypoint: detail.meta.entrypoint,
              b: (chunks) => <strong>{chunks}</strong>,
              code: (chunks) => <code>{chunks}</code>,
            })}
          />
        )}

        {detail.files.length === 0 ? (
          <EmptyState icon={FileText} title={t("empty")} />
        ) : (
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
                <QuickActions
                  key={file.name}
                  render={<TableRow interactive />}
                  name={file.name}
                  kind="file"
                  openHref={editHref(path, owner, file.name)}
                  downloadHref={api.fileRawPath(joinPath(path, file.name), owner)}
                  // Generated files are maintained by the API and viewers cannot
                  // change anything — in both cases the menu simply has no
                  // destructive item, matching the row's own trailing actions.
                  deleteAction={
                    !file.generated && canEdit
                      ? deleteFileAction.bind(null, joinPath(path, file.name), owner)
                      : undefined
                  }
                  deleteTitle={t("files.deleteTitle")}
                  deleteDescription={t("files.deleteDescription", { name: file.name })}
                >
                  <TableCell>
                    <a href={editHref(path, owner, file.name)} className="flex items-center gap-2">
                      <FileIcon name={file.name} />
                      {file.name}
                      {file.generated && (
                        <span title={t("files.generatedTitle")}>
                          <Icon icon={Lock} size={12} className="text-text-muted" />
                        </span>
                      )}
                    </a>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" tone="neutral">
                      {typeOf(file.name).label}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatSize(file.size)}</TableCell>
                  <TableCell>{formatDate(file.modified_at)}</TableCell>
                  <TableCell align="right">
                    <div className="flex justify-end gap-1">
                      {/* A download is a navigation, so it stays an anchor
                          wearing the button skin rather than an IconButton. */}
                      <LinkButton
                        href={api.fileRawPath(joinPath(path, file.name), owner)}
                        external
                        variant="ghost"
                        aria-label={t("files.downloadAriaLabel", { name: file.name })}
                      >
                        <Download className="size-3.5" />
                      </LinkButton>
                      {!file.generated && canEdit && (
                        <DeleteFileButton fullPath={joinPath(path, file.name)} owner={owner} name={file.name} />
                      )}
                    </div>
                  </TableCell>
                </QuickActions>
              ))}
            </TableBody>
          </Table>
        )}

        {detail.versions.length > 1 && (
          <div className="flex flex-col gap-2">
            <Heading level={2}>{t("versions.subtitle")}</Heading>
            <Table>
              <TableBody>
                {detail.versions.map((version) => (
                  <TableRow key={version.seq} terminal={!version.current}>
                    <TableCell className="font-medium">v{version.seq}</TableCell>
                    <TableCell>
                      {version.current && (
                        <Badge variant="tonal" tone="success">
                          {t("versions.current")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-text-muted">
                      {t("versions.filesCount", { count: version.files })} · {formatSize(version.size)}
                    </TableCell>
                    <TableCell className="text-text-muted">{formatDate(version.published_at)}</TableCell>
                    <TableCell align="right">
                      <div className="flex justify-end gap-2">
                        <LinkButton
                          href={version.url}
                          external
                          variant="ghost"
                          aria-label={t("versions.viewAriaLabel", { seq: version.seq })}
                        >
                          <ExternalLink className="size-3.5" />
                          {t("versions.view")}
                        </LinkButton>
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
        )}
      </div>
    </AdminLayout>
  );
}
