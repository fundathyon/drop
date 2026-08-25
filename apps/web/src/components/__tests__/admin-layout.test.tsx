import { describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { FoundathyonProvider, TooltipProvider } from "@foundathyon/community-ui";

const logoutAction = mock(async () => {});
mock.module("@/lib/actions/auth", () => ({ logoutAction }));

const { AdminLayout } = await import("../admin-layout");

const messages = {
  common: { appName: "Drop", adminSuffix: "admin" },
  nav: {
    unitsAriaLabel: "Unidades",
    myDrive: "Mi unidad",
    sharedWithMe: "Compartido conmigo",
    home: "Inicio",
    routeAriaLabel: "Ruta",
    themeToggleAriaLabel: "Cambiar tema",
    accountRoleLabel: "{email} · {role}",
    manageUsers: "Usuarios e invitaciones",
    signOut: "Cerrar sesión",
    roleAdmin: "admin",
    roleUser: "user",
  },
  colors: {
    title: "Acento",
    hint: "Herramienta de desarrollo.",
    names: {
      red: "Rojo", orange: "Naranja", amber: "Ámbar", lime: "Lima", emerald: "Verde",
      teal: "Turquesa", cyan: "Cian", sky: "Celeste", blue: "Azul", indigo: "Índigo",
      violet: "Violeta", purple: "Púrpura", magenta: "Magenta", pink: "Rosa",
    },
  },
};

const user = {
  id: 1,
  email: "rafa@drop.test",
  name: "Rafa",
  role: "admin" as const,
  active: true,
  created_at: "2024-01-01T00:00:00Z",
};

function renderShell(props: Partial<React.ComponentProps<typeof AdminLayout>> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <FoundathyonProvider>
        <TooltipProvider>
          <AdminLayout user={user} {...props}>
            <p>contenido</p>
          </AdminLayout>
        </TooltipProvider>
      </FoundathyonProvider>
    </NextIntlClientProvider>
  );
}

/**
 * The admin shell only ever renders behind a session, so nothing else in this
 * suite reaches it — and three separate breakages have now lived here. These
 * assertions are deliberately structural rather than cosmetic: they encode the
 * mistakes, not the design.
 */
describe("AdminLayout", () => {
  test("every link has a real destination", () => {
    // The bug this locks down: Breadcrumb hands `render` a props object
    // containing `href: item.href`, so an item without `href` passes
    // `href: undefined` — and spreading it last wipes out the router link's
    // own destination.
    const { container } = renderShell({
      crumbs: [
        { name: "Proyectos", href: "/Proyectos" },
        { name: "2024", href: "/Proyectos/2024" },
      ],
    });

    const anchors = [...container.querySelectorAll("a")];
    expect(anchors.length).toBeGreaterThan(0);

    const broken = anchors
      .filter((a) => {
        const href = a.getAttribute("href");
        return href === null || href === "" || href === "undefined";
      })
      .map((a) => a.textContent?.trim());

    expect(broken).toEqual([]);
  });

  test("the breadcrumb trail points at the crumbs it was given", () => {
    const { container } = renderShell({
      crumbs: [
        { name: "Proyectos", href: "/Proyectos" },
        { name: "2024", href: "/Proyectos/2024" },
      ],
    });

    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/Proyectos");
    // Root crumb: "Mi unidad" by default, "Compartido conmigo" in the shared section.
    expect(hrefs).toContain("/");
  });

  test("the last crumb is the current page, so it is text and not a link (§12)", () => {
    const { container } = renderShell({
      crumbs: [
        { name: "Proyectos", href: "/Proyectos" },
        { name: "2024", href: "/Proyectos/2024" },
      ],
    });

    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/Proyectos/2024");
    // Scoped to the trail: the sidebar marks its own current item the same way.
    const trail = container.querySelector('nav[aria-label="Ruta"]')!;
    expect(trail.querySelector('[aria-current="page"]')?.textContent).toBe("2024");
  });

  test("the shared section roots the trail at /compartido", () => {
    // A crumb is needed for the root to be a link at all: with nothing after it,
    // the root IS the current page and renders as text.
    const { container } = renderShell({
      section: "shared",
      crumbs: [{ name: "Informe", href: "/Informe" }],
    });

    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/compartido");
  });

  test("renders no nested interactive elements", () => {
    const { container } = renderShell({ crumbs: [{ name: "Proyectos", href: "/Proyectos" }] });

    expect(container.querySelector("button button")).toBeNull();
    expect(container.querySelector("a button")).toBeNull();
    expect(container.querySelector("button a")).toBeNull();
    expect(container.querySelector("a a")).toBeNull();
  });
});
