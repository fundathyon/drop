"use client";

import { House, Package, User, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Sidebar, SidebarHeader, SidebarItem, SidebarSection } from "@foundathyon/community-ui";
import { Link } from "@/i18n/navigation";
import type { UserInfo } from "@/lib/types";

// A client component, not part of admin-layout: SidebarItem's `render` is a
// function and Sidebar is a client component, so the prop can only be handed
// over from this side of the boundary.
//
// The spread goes before `href` in every render below. SidebarItem happens to
// guard against this (it only emits `href` when it has one), but Breadcrumb
// does not — and relying on which library component remembered to is how the
// breadcrumb links ended up pointing at `undefined`.
export function AdminSidebar({ user, section }: { user: UserInfo; section?: "shared" | "users" }) {
  const t = useTranslations("nav");
  const c = useTranslations("common");

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2 font-semibold whitespace-nowrap">
          <Package className="size-5 shrink-0" aria-hidden="true" />
          <span>{c("appName")}</span>
          <span className="text-text-muted text-sm font-normal">{c("adminSuffix")}</span>
        </Link>
      </SidebarHeader>

      <SidebarSection label={t("unitsAriaLabel")}>
        <SidebarItem
          icon={House}
          label={t("myDrive")}
          current={!section}
          render={(props) => <Link {...props} href="/" />}
        />
        <SidebarItem
          icon={Users}
          label={t("sharedWithMe")}
          current={section === "shared"}
          render={(props) => <Link {...props} href="/compartido" />}
        />
        {user.role === "admin" && (
          <SidebarItem
            icon={User}
            label={t("manageUsers")}
            current={section === "users"}
            render={(props) => <Link {...props} href="/admin/usuarios" />}
          />
        )}
      </SidebarSection>
    </Sidebar>
  );
}
