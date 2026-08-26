import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { FoundathyonProvider, SidebarProvider, TooltipProvider } from "@foundathyon/community-ui";

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
    toggleSidebar: "Mostrar u ocultar el menú",
    sidebarHint: "Menú <kbd>⌘B</kbd>",
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

// SidebarProvider is supplied by the (admin) route-group layout in the real
// app — it is the one place that can read the request. `storageKey: null`
// mirrors it: the preference is a cookie, not localStorage (lib/sidebar.ts).
function renderShell(
  props: Partial<React.ComponentProps<typeof AdminLayout>> = {},
  { collapsed = false }: { collapsed?: boolean } = {}
) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <FoundathyonProvider>
        <TooltipProvider>
          <SidebarProvider defaultCollapsed={collapsed} storageKey={null}>
            <AdminLayout user={user} {...props}>
              <p>contenido</p>
            </AdminLayout>
          </SidebarProvider>
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

/**
 * The collapse behaviour is the half of §12 the shell shipped without. It is
 * also state that does not exist until something toggles it — the same blind
 * spot that let a menu ship with its popup broken, because every test rendered
 * it closed. So these drive the real toggle and assert on the collapsed tree.
 */
describe("AdminLayout · sidebar collapse", () => {
  const trigger = (c: HTMLElement) =>
    c.querySelector<HTMLButtonElement>('button[aria-label="Mostrar u ocultar el menú"]')!;
  const sidebar = (c: HTMLElement) => c.querySelector("aside")!;

  test("the shell offers a visible collapse trigger, outside the sidebar", () => {
    const { container } = renderShell();

    const button = trigger(container);
    expect(button).toBeTruthy();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    // Outside: collapsed to 48px of icons, a trigger living INSIDE the rail is
    // how the shell strands someone with no visible way back.
    expect(sidebar(container).contains(button)).toBe(false);
  });

  test("clicking the trigger collapses the sidebar and expands it again", () => {
    const { container } = renderShell();
    const button = trigger(container);

    expect(sidebar(container).hasAttribute("data-collapsed")).toBe(false);

    fireEvent.click(button);
    expect(sidebar(container).hasAttribute("data-collapsed")).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);
    expect(sidebar(container).hasAttribute("data-collapsed")).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  test("⌘B toggles it too — the shortcut the footer advertises", () => {
    const { container } = renderShell();

    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(sidebar(container).hasAttribute("data-collapsed")).toBe(true);

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(sidebar(container).hasAttribute("data-collapsed")).toBe(false);
  });

  test("collapsed, nothing but icons is left in the 48px rail", () => {
    const { container } = renderShell();
    fireEvent.click(trigger(container));

    const aside = sidebar(container);
    // The wordmark and the ⌘B hint are plain text with no `sr-only` fallback
    // of their own — left in place they simply overflow the rail.
    expect(aside.textContent).not.toContain("admin");
    expect(aside.textContent).not.toContain("⌘B");
    // Destinations survive, as labels for screen readers.
    expect(aside.querySelectorAll("a[href]").length).toBeGreaterThan(0);
    expect(aside.querySelector('[aria-label="Drop admin"]')).toBeTruthy();
  });

  test("expanded, the wordmark and the shortcut hint are both visible", () => {
    const { container } = renderShell();
    const aside = sidebar(container);

    expect(aside.textContent).toContain("Drop");
    expect(aside.textContent).toContain("admin");
    expect(aside.textContent).toContain("⌘B");
    expect(aside.querySelector("kbd")).toBeTruthy();
  });

  test("a preference resolved on the server renders collapsed from the start", () => {
    // The whole reason the preference is a cookie: this is the first paint,
    // not a post-hydration correction. Read from localStorage the server would
    // have emitted an expanded rail here and React would have thrown on the
    // mismatch instead of warning.
    const { container } = renderShell({}, { collapsed: true });

    expect(sidebar(container).hasAttribute("data-collapsed")).toBe(true);
    expect(trigger(container).getAttribute("aria-expanded")).toBe("false");
    expect(sidebar(container).textContent).not.toContain("⌘B");
  });
});
