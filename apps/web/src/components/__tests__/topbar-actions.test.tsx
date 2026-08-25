import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { FoundathyonProvider, TooltipProvider } from "@foundathyon/community-ui";

// logoutAction is a Server Action ("use server" + session imports); stub it so
// the component can be rendered on its own, same pattern as the other suites.
const logoutAction = mock(async () => {});
mock.module("@/lib/actions/auth", () => ({ logoutAction }));

const { AccountMenu } = await import("../account-menu");
const { ThemeToggle } = await import("../theme-toggle");
const { AccentPicker } = await import("../accent-picker");

const messages = {
  nav: {
    accountRoleLabel: "{email} · {role}",
    signOut: "Cerrar sesión",
    roleAdmin: "admin",
    roleUser: "user",
    themeToggleAriaLabel: "Cambiar tema",
  },
  colors: {
    title: "Acento",
    hint: "Herramienta de desarrollo.",
    names: {
      red: "Rojo",
      orange: "Naranja",
      amber: "Ámbar",
      lime: "Lima",
      emerald: "Verde",
      teal: "Turquesa",
      cyan: "Cian",
      sky: "Celeste",
      blue: "Azul",
      indigo: "Índigo",
      violet: "Violeta",
      purple: "Púrpura",
      magenta: "Magenta",
      pink: "Rosa",
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

function renderChrome(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <FoundathyonProvider>
        <TooltipProvider>{ui}</TooltipProvider>
      </FoundathyonProvider>
    </NextIntlClientProvider>
  );
}

/**
 * The topbar's trailing cluster is the part of the shell that only ever renders
 * behind a session, so nothing else in this suite reaches it — and it is where
 * a nested-button hydration error lived: UserMenu renders its `trigger` as the
 * CHILDREN of its own button (unlike DialogTrigger's `render`, which
 * substitutes), so handing it a Button produced `<button><button>`.
 */
describe("topbar actions", () => {
  test("AccountMenu never nests a button inside its trigger", () => {
    const { container } = renderChrome(<AccountMenu user={user} />);

    expect(container.querySelector("button")).toBeTruthy();
    expect(container.querySelector("button button")).toBeNull();
  });

  test("AccountMenu's trigger carries an accessible name", () => {
    const { container } = renderChrome(<AccountMenu user={user} />);

    const trigger = container.querySelector("button")!;
    // The library labels the trigger with the user's name itself.
    expect(trigger.getAttribute("aria-label")).toBe("Rafa");
  });

  test("the whole trailing cluster renders without nested interactive elements", () => {
    const { container } = renderChrome(
      <>
        <AccentPicker />
        <ThemeToggle ariaLabel="Cambiar tema" />
        <AccountMenu user={user} />
      </>
    );

    expect(container.querySelector("button button")).toBeNull();
    expect(container.querySelector("a button")).toBeNull();
    expect(container.querySelector("button a")).toBeNull();
  });
  /**
   * Opening matters: a menu's popup only mounts on open, so rendering the
   * closed trigger proves nothing about what is inside. That is exactly how a
   * DropdownMenuGroupLabel placed outside a DropdownMenuGroup shipped — Base UI
   * throws "MenuGroupContext is missing" the moment the popup renders, and the
   * whole page died on the first click.
   */
  async function open(label: string) {
    const trigger = screen.getByRole("button", { name: label });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    return trigger;
  }

  test("the accent menu opens and lists every accent", async () => {
    renderChrome(<AccentPicker />);
    await open("Acento");

    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    const options = screen.getAllByRole("menuitem");
    expect(options).toHaveLength(14);
    expect(screen.getByText("Azul")).toBeTruthy();
    expect(screen.getByText("Verde")).toBeTruthy();
  });

  test("choosing an accent writes it to <html>", async () => {
    document.documentElement.removeAttribute("data-accent");
    renderChrome(<AccentPicker />);
    await open("Acento");

    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    fireEvent.click(screen.getByText("Verde").closest('[role="menuitem"]')!);

    await waitFor(() => expect(document.documentElement.dataset.accent).toBe("emerald"));
    document.documentElement.removeAttribute("data-accent");
  });

  test("the account menu opens and offers sign out", async () => {
    renderChrome(<AccountMenu user={user} />);
    await open("Rafa");

    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    expect(screen.getByText("Cerrar sesión")).toBeTruthy();
    expect(screen.getByText("rafa@drop.test · admin")).toBeTruthy();
  });
});
