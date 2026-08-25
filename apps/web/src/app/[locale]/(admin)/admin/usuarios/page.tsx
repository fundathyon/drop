import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
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
import { formatDate } from "@/lib/format";
import { InviteDialog } from "./invite-dialog";
import { UserActions } from "./user-actions";
import { RevokeInvitationButton } from "./revoke-invitation-button";
import type { InvitationInfo, InvitationStatus, UserInfo } from "@/lib/types";

const invitationStatusVariant: Record<InvitationStatus, "secondary" | "outline"> = {
  pending: "secondary",
  accepted: "outline",
  expired: "outline",
  revoked: "outline",
};

export default async function UsersPage() {
  const currentUser = await requireAdmin();
  const t = await getTranslations("users");
  const { users } = await api.listUsers();
  const { invitations } = await api.listInvitations();

  return (
    <AdminLayout
      user={currentUser}
      section="users"
      crumbs={[{ name: t("breadcrumb"), href: "/admin/usuarios" }]}
      actions={<InviteDialog />}
    >
      <section className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">{t("accountsTitle")}</h1>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("nameHeader")}</TableHead>
                <TableHead>{t("emailHeader")}</TableHead>
                <TableHead>{t("roleHeader")}</TableHead>
                <TableHead>{t("statusHeader")}</TableHead>
                <TableHead>{t("lastLoginHeader")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <UserRow key={u.id} user={u} isCurrent={u.id === currentUser.id} t={t} />
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {invitations.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("invitationsTitle")}</h2>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableBody>
                {invitations.map((inv) => (
                  <InvitationRow key={inv.id} invitation={inv} t={t} />
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </AdminLayout>
  );
}

function UserRow({
  user,
  isCurrent,
  t,
}: {
  user: UserInfo;
  isCurrent: boolean;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <Icon name="user" className="size-4 text-muted-foreground" />
          {user.name}
          {isCurrent && <Badge variant="outline">{t("you")}</Badge>}
        </div>
      </TableCell>
      <TableCell>{user.email}</TableCell>
      <TableCell>
        <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role}</Badge>
      </TableCell>
      <TableCell>
        <Badge variant={user.active ? "secondary" : "outline"}>
          {user.active ? t("active") : t("inactive")}
        </Badge>
      </TableCell>
      <TableCell>{formatDate(user.last_login_at)}</TableCell>
      <TableCell className="text-right">
        {!isCurrent && <UserActions id={user.id} active={user.active} email={user.email} />}
      </TableCell>
    </TableRow>
  );
}

function InvitationRow({
  invitation,
  t,
}: {
  invitation: InvitationInfo;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <Icon name="mail" className="size-4 text-muted-foreground" />
          {invitation.email}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={invitation.role === "admin" ? "default" : "secondary"}>{invitation.role}</Badge>
      </TableCell>
      <TableCell>
        <Badge variant={invitationStatusVariant[invitation.status]}>
          {t(`invitationStatus.${invitation.status}`)}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {t("expiresAt", { date: formatDate(invitation.expires_at) })}
      </TableCell>
      <TableCell className="text-right">
        {invitation.status === "pending" && (
          <RevokeInvitationButton id={invitation.id} email={invitation.email} />
        )}
      </TableCell>
    </TableRow>
  );
}
