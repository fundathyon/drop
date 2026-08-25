import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccountMenu } from "@/components/account-menu";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";
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
  const shared = section === "shared";

  return (
    <div className="flex h-svh overflow-hidden">
      <aside className="flex w-60 shrink-0 flex-col gap-1 border-r bg-background py-4">
        <Link href="/" className="flex items-center gap-2 px-4 pb-4 font-semibold whitespace-nowrap">
          <Icon name="package" className="size-5" />
          <span>Drop</span>
          <span className="text-sm font-normal text-muted-foreground">admin</span>
        </Link>

        <nav aria-label={t("unitsAriaLabel")} className="flex flex-col gap-0.5 px-3">
          <SidebarLink href="/" icon="house" active={!section}>
            {t("myDrive")}
          </SidebarLink>
          <SidebarLink href="/compartido" icon="users" active={shared}>
            {t("sharedWithMe")}
          </SidebarLink>
          {user.role === "admin" && (
            <SidebarLink href="/admin/usuarios" icon="user" active={section === "users"}>
              {t("manageUsers")}
            </SidebarLink>
          )}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-background/80 px-4 py-3 backdrop-blur">
          {crumbs && <Breadcrumbs crumbs={crumbs} shared={shared} homeLabel={t("home")} ariaLabel={t("routeAriaLabel")} />}

          <div className="flex-1" />

          {actions}
          <ThemeToggle ariaLabel={t("themeToggleAriaLabel")} />
          <AccountMenu user={user} />
        </header>

        <main className="flex flex-1 flex-col overflow-y-auto px-4 py-6 md:px-8">
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SidebarLink({
  href,
  icon,
  active,
  children,
}: {
  href: string;
  icon: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-full px-4 py-2 text-sm transition-colors",
        active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon name={icon} className="size-4 shrink-0" />
      <span className="truncate">{children}</span>
    </Link>
  );
}

function Breadcrumbs({
  crumbs,
  shared,
  homeLabel,
  ariaLabel,
}: {
  crumbs: Crumb[];
  shared?: boolean;
  homeLabel: string;
  ariaLabel: string;
}) {
  return (
    <nav aria-label={ariaLabel} className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
      <Icon name={shared ? "users" : "house"} className="size-4 shrink-0" />
      {crumbs.length === 0 ? (
        <span>{homeLabel}</span>
      ) : (
        crumbs.map((crumb, i) => (
          <span key={crumb.href} className="flex items-center gap-1 truncate">
            {i > 0 && <Icon name="chevron-right" className="size-3.5 shrink-0" />}
            {i === crumbs.length - 1 ? (
              <span className="truncate text-foreground">{crumb.name}</span>
            ) : (
              <Link href={crumb.href} className="truncate hover:text-foreground">
                {crumb.name}
              </Link>
            )}
          </span>
        ))
      )}
    </nav>
  );
}
