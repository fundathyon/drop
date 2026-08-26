"use client";

import { House, Package, User, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Kbd,
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarSection,
  useSidebar,
} from "@foundathyon/community-ui";
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

  // §12: collapsed is 48 icon-only pixels. SidebarSection and SidebarItem
  // already step aside on their own (labels go `sr-only`, counters hide); the
  // two slots the library hands over whole — header and footer — are the
  // caller's job, and text left in them is what overflows a 48px rail.
  const { collapsed } = useSidebar();

  return (
    <Sidebar>
      <SidebarHeader>
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold whitespace-nowrap"
          // Collapsed the wordmark is gone, so the icon has to carry the name.
          aria-label={collapsed ? `${c("appName")} ${c("adminSuffix")}` : undefined}
        >
          <Package className="size-5 shrink-0" aria-hidden="true" />
          {!collapsed && (
            <>
              <span>{c("appName")}</span>
              <span className="text-text-muted text-sm font-normal">{c("adminSuffix")}</span>
            </>
          )}
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

      {/* ⌘B is a suite-wide shortcut a product cannot reassign (§17), which
          also makes it something a product has to teach. The Topbar trigger is
          the discoverable half; this is the half that tells you there is a
          faster way. */}
      {!collapsed && (
        <SidebarFooter>
          <span className="text-caption text-text-muted flex items-center gap-1.5 px-4">
            {t.rich("sidebarHint", { kbd: (chunks) => <Kbd>{chunks}</Kbd> })}
          </span>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
