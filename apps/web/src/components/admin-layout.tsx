import { useTranslations } from "next-intl";
import { Breadcrumb, SidebarProvider, Topbar, type BreadcrumbItem } from "@foundathyon/community-ui";
import { Link } from "@/i18n/navigation";
import { AccentPicker } from "@/components/accent-picker";
import { AdminSidebar } from "@/components/admin-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccountMenu } from "@/components/account-menu";
import { SHOW_PALETTE_TOOLS } from "@/lib/flags";
import type { UserInfo } from "@/lib/types";

export interface Crumb {
  name: string;
  href: string;
}

export function AdminLayout({
  user,
  section,
  crumbs,
  actions,
  children,
}: {
  user: UserInfo;
  // Which sidebar item is current. Omitted means "Mi unidad" — the default
  // you land on for your own drive, at any depth.
  section?: "shared" | "users";
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("nav");

  const rootHref = section === "shared" ? "/compartido" : "/";

  // Breadcrumb is server-safe, so its `render` functions never cross a client
  // boundary and can build next-intl Links directly.
  //
  // Two details, both load-bearing. `href` goes on the item, not just inside
  // `render`: Breadcrumb builds `{ href: item.href, className, children }` and
  // hands that to `render`, so leaving it off means it passes `href: undefined`.
  // And the spread comes BEFORE `href` for the same reason — spreading last
  // clobbers the router link's destination with that undefined. (SidebarItem
  // guards against exactly this and only emits `href` when it has one;
  // Breadcrumb does not, so the caller has to.)
  const items: BreadcrumbItem[] = [
    {
      label: section === "shared" ? t("sharedWithMe") : t("home"),
      href: rootHref,
      render: (props) => <Link {...props} href={rootHref} />,
    },
    ...(crumbs ?? []).map((crumb) => ({
      label: crumb.name,
      href: crumb.href,
      render: (props: React.ComponentProps<"a">) => <Link {...props} href={crumb.href} />,
    })),
  ];

  return (
    <SidebarProvider storageKey="drop-sidebar">
      <div className="flex h-svh overflow-hidden">
        <AdminSidebar user={user} section={section} />

        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar
            leading={crumbs ? <Breadcrumb items={items} label={t("routeAriaLabel")} /> : null}
            trailing={
              <>
                {actions}
                {SHOW_PALETTE_TOOLS && <AccentPicker />}
                <ThemeToggle ariaLabel={t("themeToggleAriaLabel")} />
                <AccountMenu user={user} />
              </>
            }
          />

          <main className="flex flex-1 flex-col overflow-y-auto px-4 py-6 md:px-8">
            <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4">{children}</div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
