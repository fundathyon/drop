import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/session";
import { api } from "@/lib/api";
import { AdminLayout, type Crumb } from "@/components/admin-layout";
import { Icon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { decodePathSegments } from "@/lib/format";
import { NewFolderDialog } from "./new-folder-dialog";
import { NewDropDialog } from "./new-drop-dialog";
import { DeleteNodeButton } from "./delete-node-button";
import type { Node } from "@/lib/types";

function nodeQuery(owner?: number) {
  return owner ? `?owner=${owner}` : "";
}

function nodeHref(path: string, owner?: number) {
  return `/${path}${nodeQuery(owner)}`;
}

function viewHref(path: string, owner: number | undefined, mode: "grid" | "list") {
  const q = new URLSearchParams();
  if (owner) q.set("owner", String(owner));
  q.set("view", mode);
  return `/${path}?${q.toString()}`;
}

function buildCrumbs(path: string, owner?: number): Crumb[] {
  if (!path) return [];
  const parts = path.split("/");
  let acc = "";
  return parts.map((name) => {
    acc = acc ? `${acc}/${name}` : name;
    return { name, href: nodeHref(acc, owner) };
  });
}

export default async function ExplorerPage({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<{ owner?: string; view?: string }>;
}) {
  const user = await requireUser();
  const { path: pathSegments } = await params;
  const { owner: ownerParam, view } = await searchParams;
  const path = decodePathSegments(pathSegments ?? []);
  const owner = ownerParam ? Number(ownerParam) : undefined;
  const mode = view === "list" ? "list" : "grid";

  const t = await getTranslations("explorer");
  const list = await api.listNodes(path, owner);

  const actions = (
    <>
      <div
        role="group"
        aria-label={t("viewModeAriaLabel")}
        className="flex items-center gap-1 rounded-md bg-muted p-1"
      >
        <Button asChild variant={mode === "grid" ? "secondary" : "ghost"} size="icon" aria-pressed={mode === "grid"}>
          <Link href={viewHref(path, owner, "grid")} aria-label={t("gridView")}>
            <Icon name="layout-grid" className="size-4" />
          </Link>
        </Button>
        <Button asChild variant={mode === "list" ? "secondary" : "ghost"} size="icon" aria-pressed={mode === "list"}>
          <Link href={viewHref(path, owner, "list")} aria-label={t("listView")}>
            <Icon name="list" className="size-4" />
          </Link>
        </Button>
      </div>
      <NewFolderDialog parent={path} owner={owner} />
      <NewDropDialog parent={path} owner={owner} />
    </>
  );

  return (
    <AdminLayout user={user} section={owner ? "shared" : undefined} crumbs={buildCrumbs(path, owner)} actions={actions}>
      {list.children.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-muted-foreground">
          <Icon name="folder" className="size-8" />
          <p>{t("empty")}</p>
        </div>
      ) : mode === "list" ? (
        <ListView nodes={list.children} owner={owner} t={t} />
      ) : (
        <GridView nodes={list.children} owner={owner} t={t} />
      )}
    </AdminLayout>
  );
}

function nodeTarget(node: Node, owner?: number) {
  return node.kind === "drop" ? `/drop/${node.path}${nodeQuery(owner)}` : nodeHref(node.path, owner);
}

function ListView({
  nodes,
  owner,
  t,
}: {
  nodes: Node[];
  owner?: number;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("nameHeader")}</TableHead>
            <TableHead>{t("typeHeader")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.map((node) => (
            <TableRow key={node.path}>
              <TableCell>
                <Link href={nodeTarget(node, owner)} className="flex items-center gap-2">
                  <Icon name={node.kind === "drop" ? "package" : "folder"} className="size-4 text-muted-foreground" />
                  {node.name}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant={node.kind === "drop" ? "default" : "secondary"}>
                  {t(node.kind === "drop" ? "dropBadge" : "folderBadge")}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <DeleteNodeButton path={node.path} owner={owner} name={node.name} kind={node.kind} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function GridView({
  nodes,
  owner,
  t,
}: {
  nodes: Node[];
  owner?: number;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
      {nodes.map((node) => (
        <div key={node.path} className="group relative rounded-lg border p-4 hover:bg-accent/50">
          <Link href={nodeTarget(node, owner)} className="flex flex-col items-start gap-2">
            <Icon name={node.kind === "drop" ? "package" : "folder"} className="size-6 text-muted-foreground" />
            <span className="w-full truncate text-sm font-medium" title={node.name}>
              {node.name}
            </span>
            <Badge variant={node.kind === "drop" ? "default" : "secondary"}>
              {t(node.kind === "drop" ? "dropBadge" : "folderBadge")}
            </Badge>
          </Link>
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            <DeleteNodeButton path={node.path} owner={owner} name={node.name} kind={node.kind} />
          </div>
        </div>
      ))}
    </div>
  );
}
