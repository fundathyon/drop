import { getTranslations } from "next-intl/server";
import { FolderOpen, LayoutGrid, List as ListIcon } from "lucide-react";
import {
  Badge,
  EmptyState,
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
import { FinderIcon } from "@/components/finder-icon";
import { LinkButton } from "@/components/link-button";
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

  // Links, not buttons: switching the view is a navigation (it lives in the
  // URL), and §09 is explicit that something which navigates is a Link however
  // it looks. LinkButton gives them the button skin without pretending they are
  // buttons — including to assistive tech, which gets `aria-current` rather
  // than a bogus `aria-pressed` on an anchor.
  const viewLink = (target: "grid" | "list", label: string, glyph: React.ReactNode) => (
    <LinkButton
      href={viewHref(path, owner, target)}
      aria-label={label}
      aria-current={mode === target ? "true" : undefined}
      variant={mode === target ? "secondary" : "ghost"}
    >
      {glyph}
    </LinkButton>
  );

  const actions = (
    <>
      <div
        role="group"
        aria-label={t("viewModeAriaLabel")}
        className="bg-surface-raised flex items-center gap-0.5 rounded-md p-0.5"
      >
        {viewLink("grid", t("gridView"), <LayoutGrid className="size-4" />)}
        {viewLink("list", t("listView"), <ListIcon className="size-4" />)}
      </div>
      <NewFolderDialog parent={path} owner={owner} />
      <NewDropDialog parent={path} owner={owner} />
    </>
  );

  return (
    <AdminLayout user={user} section={owner ? "shared" : undefined} crumbs={buildCrumbs(path, owner)} actions={actions}>
      {list.children.length === 0 ? (
        <EmptyState icon={FolderOpen} title={t("empty")} />
      ) : mode === "list" ? (
        <ListView nodes={list.children} owner={owner} t={t} />
      ) : (
        <GridView nodes={list.children} owner={owner} />
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
          <TableRow key={node.path} interactive>
            <TableCell>
              <Link href={nodeTarget(node, owner)} className="flex items-center gap-2.5">
                <FinderIcon kind={node.kind} name={node.name} size={22} />
                {node.name}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant="outline" tone="neutral">
                {t(node.kind === "drop" ? "dropBadge" : "folderBadge")}
              </Badge>
            </TableCell>
            <TableCell align="right">
              <DeleteNodeButton path={node.path} owner={owner} name={node.name} kind={node.kind} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Finder's icon view: the artwork carries the kind, so there is no type badge
 * here — a folder already looks like a folder. The tile is the hit area and the
 * whole thing lights up on hover, the way a Finder item does; the label wraps
 * to two lines and then ellipsizes rather than truncating a name mid-word on
 * the first line.
 */
function GridView({ nodes, owner }: { nodes: Node[]; owner?: number }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-1">
      {nodes.map((node) => (
        <li key={node.path} className="group relative">
          <Link
            href={nodeTarget(node, owner)}
            className="hover:bg-surface-hover focus-visible:ring-focus flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 outline-none focus-visible:ring-2"
          >
            <FinderIcon kind={node.kind} name={node.name} size={64} />
            <span
              className="line-clamp-2 w-full text-center text-xs leading-tight break-words hyphens-auto"
              title={node.name}
            >
              {node.name}
            </span>
          </Link>
          <div className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <DeleteNodeButton path={node.path} owner={owner} name={node.name} kind={node.kind} />
          </div>
        </li>
      ))}
    </ul>
  );
}
