import { useTranslations } from "next-intl";
import { Breadcrumb, SidebarTrigger, type BreadcrumbItem } from "@foundathyon/community-ui";
import { Link } from "@/i18n/navigation";
import { AccentPicker } from "@/components/accent-picker";
import { AdminSidebar } from "@/components/admin-sidebar";
import { ShellMain } from "@/components/shell-main";
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
  wide,
  children,
}: {
  user: UserInfo;
  // Which sidebar item is current. Omitted means "Mi unidad" — the default
  // you land on for your own drive, at any depth.
  section?: "shared" | "users";
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  /** See ShellMain: full-width content, for pages that are a tool. */
  wide?: boolean;
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

  // SidebarProvider is NOT here: it lives in the (admin) route-group layout,
  // which is the highest point that can read the request and therefore the
  // only place the collapse preference can be resolved before the HTML is
  // rendered. See lib/sidebar.ts.
  return (
    <div className="flex h-svh overflow-hidden">
      <AdminSidebar user={user} section={section} />

      <ShellMain
        wide={wide}
        // SidebarTrigger lives OUTSIDE the sidebar, in the Topbar's leading
        // zone, exactly as §12 places it — and that position is what makes it
        // work. The collapse preference is persisted per product, so a shell
        // whose only way back is ⌘B strands anyone who collapsed it once and
        // never learned the shortcut: 48px of unlabelled icons, no visible
        // way out. The trigger is always rendered, at both widths.
        leading={
          <>
            <SidebarTrigger label={t("toggleSidebar")} />
            {crumbs ? <Breadcrumb items={items} label={t("routeAriaLabel")} /> : null}
          </>
        }
        trailing={
          <>
            {actions}
            {SHOW_PALETTE_TOOLS && <AccentPicker />}
            <ThemeToggle ariaLabel={t("themeToggleAriaLabel")} />
            <AccountMenu user={user} />
          </>
        }
      >
        {children}
      </ShellMain>
    </div>
  );
}
