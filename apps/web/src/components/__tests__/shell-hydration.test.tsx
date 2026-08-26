import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import { NextIntlClientProvider } from "next-intl";
import { FoundathyonProvider, TooltipProvider } from "@foundathyon/community-ui";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";

const logoutAction = mock(async () => {});
mock.module("@/lib/actions/auth", () => ({ logoutAction }));

let cookieValue: string | undefined;
mock.module("next/headers", () => ({
  cookies: mock(async () => ({
    get: (name: string) =>
      name === SIDEBAR_COOKIE && cookieValue !== undefined ? { name, value: cookieValue } : undefined,
  })),
}));

const { AdminLayout } = await import("../admin-layout");
// The REAL route-group layout, so a regression in how it configures
// SidebarProvider is caught here and not just asserted about in isolation.
const AdminGroupLayout = (await import("../../app/[locale]/(admin)/layout")).default;

const messages = {
  common: { appName: "Drop", adminSuffix: "admin" },
  nav: {
    unitsAriaLabel: "Unidades", myDrive: "Mi unidad", sharedWithMe: "Compartido conmigo",
    home: "Inicio", routeAriaLabel: "Ruta", toggleSidebar: "Mostrar u ocultar el menú",
    sidebarHint: "Menú <kbd>⌘B</kbd>", themeToggleAriaLabel: "Cambiar tema",
    accountRoleLabel: "{email} · {role}", manageUsers: "Usuarios e invitaciones",
    signOut: "Cerrar sesión", roleAdmin: "admin", roleUser: "user",
  },
  colors: { title: "Acento", hint: "x", names: { red:"a",orange:"b",amber:"c",lime:"d",emerald:"e",teal:"f",cyan:"g",sky:"h",blue:"i",indigo:"j",violet:"k",purple:"l",magenta:"m",pink:"n" } },
};
const user = { id: 1, email: "r@d.test", name: "Rafa", role: "admin" as const, active: true, created_at: "2024-01-01T00:00:00Z" };

// One tree, rendered twice: once to html the way the server would, then
// hydrated on top of it — exactly the pair that has to agree.
async function buildTree() {
  const shell = await AdminGroupLayout({
    children: (
      <AdminLayout user={user}>
        <p>contenido</p>
      </AdminLayout>
    ),
  });
  return (
    <NextIntlClientProvider locale="es" messages={messages}>
      <FoundathyonProvider>
        <TooltipProvider>{shell}</TooltipProvider>
      </FoundathyonProvider>
    </NextIntlClientProvider>
  );
}

/**
 * The shell is the only part of the app whose SERVER html depends on a stored
 * user preference: the sidebar's width is a class name, so a preference the
 * server cannot see makes the two renders disagree.
 *
 * React 19 does not warn about that — `throwOnHydrationMismatch` throws and
 * the whole tree is discarded and re-rendered on the client. Nothing else
 * catches it: it typechecks, it lints, it builds, and it only fires for
 * someone who collapsed the sidebar once and came back. Hence a test that
 * actually renders on the server and hydrates on top of that html.
 */
describe("shell hydration", () => {
  for (const collapsed of [false, true]) {
    test(`hydrates clean with the sidebar ${collapsed ? "collapsed" : "expanded"}`, async () => {
      cookieValue = collapsed ? "1" : "0";
      // A browser that disagrees with the cookie: if anything still reaches for
      // localStorage, the two renders diverge and React throws.
      window.localStorage.setItem(SIDEBAR_COOKIE, String(!collapsed));

      const tree = await buildTree();
      const serverHtml = renderToStaticMarkup(tree);
      expect(serverHtml.includes("data-collapsed")).toBe(collapsed);

      const errors: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => { errors.push(String(args[0])); };
      const host = document.createElement("div");
      host.innerHTML = serverHtml;
      document.body.appendChild(host);
      await act(async () => { hydrateRoot(host, await buildTree()); });
      console.error = original;

      const hydration = errors.filter((e) => /hydrat|did not match|server rendered/i.test(e));
      if (hydration.length) console.log(hydration.join("\n").slice(0, 1500));
      expect(hydration).toEqual([]);
      expect(host.querySelector("aside")!.hasAttribute("data-collapsed")).toBe(collapsed);
    });
  }
});
