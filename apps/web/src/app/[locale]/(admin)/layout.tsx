import { cookies } from "next/headers";
import { SidebarProvider } from "@foundathyon/community-ui";
import { SidebarPreference } from "@/components/sidebar-preference";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";

/**
 * Every page behind a session shares one shell, so the sidebar's collapse
 * state is owned here rather than inside AdminLayout: this is the highest
 * point that can read the request, and reading it on the server is the whole
 * point (lib/sidebar.ts explains what happens when it can't).
 *
 * SidebarProvider renders no DOM of its own — AdminLayout still owns the
 * layout underneath.
 */
export default async function AdminGroupLayout({ children }: { children: React.ReactNode }) {
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <SidebarProvider defaultCollapsed={collapsed} storageKey={null}>
      <SidebarPreference />
      {children}
    </SidebarProvider>
  );
}
