import { getTranslations } from "next-intl/server";
import { Mail, User } from "lucide-react";
import {
  Badge,
  Heading,
  Icon,
  RoleBadge,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type StatusKey,
} from "@foundathyon/community-ui";
import { requireAdmin } from "@/lib/session";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { formatDate } from "@/lib/format";
import { InviteDialog } from "./invite-dialog";
import { UserActions } from "./user-actions";
import { RevokeInvitationButton } from "./revoke-invitation-button";
import type { InvitationInfo, InvitationStatus, UserInfo } from "@/lib/types";

// Drop's four invitation states onto the design system's canonical taxonomy
// (§19) instead of inventing local badge variants: an accepted invitation is
// an account that exists now, which the taxonomy already calls `active`.
const invitationStatus: Record<InvitationStatus, StatusKey> = {
  pending: "pending",
  accepted: "active",
  expired: "expired",
  revoked: "revoked",
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
        <Heading level={1}>{t("accountsTitle")}</Heading>
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
      </section>

      {invitations.length > 0 && (
        <section className="flex flex-col gap-3">
          <Heading level={2}>{t("invitationsTitle")}</Heading>
          <Table>
            <TableBody>
              {invitations.map((inv) => (
                <InvitationRow key={inv.id} invitation={inv} t={t} />
              ))}
            </TableBody>
          </Table>
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
    <TableRow terminal={!user.active}>
      <TableCell>
        <div className="flex items-center gap-2">
          <Icon icon={User} size={14} className="text-text-muted" />
          {user.name}
          {isCurrent && (
            <Badge variant="outline" tone="neutral">
              {t("you")}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell>{user.email}</TableCell>
      <TableCell>
        <RoleBadge role={user.role} />
      </TableCell>
      <TableCell>
        <StatusBadge status={user.active ? "active" : "disabled"}>
          {user.active ? t("active") : t("inactive")}
        </StatusBadge>
      </TableCell>
      <TableCell>{formatDate(user.last_login_at)}</TableCell>
      <TableCell align="right">
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
    <TableRow terminal={invitation.status !== "pending"}>
      <TableCell>
        <div className="flex items-center gap-2">
          <Icon icon={Mail} size={14} className="text-text-muted" />
          {invitation.email}
        </div>
      </TableCell>
      <TableCell>
        <RoleBadge role={invitation.role} />
      </TableCell>
      <TableCell>
        <StatusBadge status={invitationStatus[invitation.status]}>
          {t(`invitationStatus.${invitation.status}`)}
        </StatusBadge>
      </TableCell>
      <TableCell className="text-text-muted">
        {t("expiresAt", { date: formatDate(invitation.expires_at) })}
      </TableCell>
      <TableCell align="right">
        {invitation.status === "pending" && (
          <RevokeInvitationButton id={invitation.id} email={invitation.email} />
        )}
      </TableCell>
    </TableRow>
  );
}
