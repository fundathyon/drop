import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";
import {
  Badge,
  EmptyState,
  RoleBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@foundathyon/community-ui";
import { requireUser } from "@/lib/session";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { FinderIcon } from "@/components/finder-icon";
import { QuickActions } from "@/components/quick-actions";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/format";
import { sharedNodeHref } from "./link-target";

export default async function SharedWithMePage() {
  const user = await requireUser();
  const t = await getTranslations("shared");
  const { nodes } = await api.listSharedWithMe();

  return (
    <AdminLayout user={user} section="shared">
      {nodes.length === 0 ? (
        <EmptyState icon={Users} title={t("empty")} description={t("emptyHint")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("nameHeader")}</TableHead>
              <TableHead>{t("typeHeader")}</TableHead>
              <TableHead>{t("ownerHeader")}</TableHead>
              <TableHead>{t("accessHeader")}</TableHead>
              <TableHead>{t("sharedHeader")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.map((node) => (
              // No destructive item on purpose: these belong to someone else.
              // Deleting is not one of the things being shared, whatever the
              // access level, so the menu stops at open and copy.
              <QuickActions
                key={node.path}
                render={<TableRow interactive />}
                name={node.name}
                kind={node.kind === "drop" ? "drop" : "folder"}
                openHref={sharedNodeHref(node.kind, node.path, node.owner)}
              >
                <TableCell>
                  <Link
                    href={sharedNodeHref(node.kind, node.path, node.owner)}
                    className="flex items-center gap-2.5"
                  >
                    <FinderIcon kind={node.kind} name={node.name} size={22} />
                    {node.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" tone="neutral">
                    {t(node.kind === "drop" ? "dropBadge" : "folderBadge")}
                  </Badge>
                </TableCell>
                <TableCell title={node.owner_email}>{node.owner_name}</TableCell>
                <TableCell>
                  {/* roleTone already reads "editor" as an ordinary participant
                      and "viewer" as passive, which is exactly this ladder. */}
                  <RoleBadge role={node.access === "editor" ? "editor" : "viewer"}>
                    {t(node.access === "editor" ? "editorBadge" : "viewerBadge")}
                  </RoleBadge>
                </TableCell>
                <TableCell>{formatDate(node.shared_at)}</TableCell>
              </QuickActions>
            ))}
          </TableBody>
        </Table>
      )}
    </AdminLayout>
  );
}
