import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/session";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { Icon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-muted-foreground">
          <Icon name="users" className="size-8" />
          <p>{t("empty")}</p>
          <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
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
                <TableRow key={node.path}>
                  <TableCell>
                    <Link
                      href={sharedNodeHref(node.kind, node.path, node.owner)}
                      className="flex items-center gap-2"
                    >
                      <Icon
                        name={node.kind === "drop" ? "package" : "folder"}
                        className="size-4 text-muted-foreground"
                      />
                      {node.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={node.kind === "drop" ? "default" : "secondary"}>
                      {t(node.kind === "drop" ? "dropBadge" : "folderBadge")}
                    </Badge>
                  </TableCell>
                  <TableCell title={node.owner_email}>{node.owner_name}</TableCell>
                  <TableCell>
                    <Badge variant={node.access === "editor" ? "secondary" : "outline"}>
                      {t(node.access === "editor" ? "editorBadge" : "viewerBadge")}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(node.shared_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AdminLayout>
  );
}
