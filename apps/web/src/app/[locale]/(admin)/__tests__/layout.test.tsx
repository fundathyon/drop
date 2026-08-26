import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { SidebarProvider, SidebarTrigger } from "@foundathyon/community-ui";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";
import { SidebarPreference } from "@/components/sidebar-preference";

let cookieValue: string | undefined;
mock.module("next/headers", () => ({
  cookies: mock(async () => ({
    get: (name: string) => (name === SIDEBAR_COOKIE && cookieValue !== undefined ? { name, value: cookieValue } : undefined),
  })),
}));

const AdminGroupLayout = (await import("../layout")).default;

/**
 * The two halves of the collapse preference. They are tested together because
 * separately neither means anything: the layout only matters if something
 * writes the cookie it reads, and the writer only matters if the server acts
 * on it.
 *
 * What is actually being locked down is a hydration crash. The sidebar's width
 * is in the server HTML, so a preference the server cannot see makes the two
 * renders disagree — and React 19 throws on that (`throwOnHydrationMismatch`),
 * discarding the tree rather than warning. A cookie is what keeps them in
 * agreement; localStorage cannot.
 */
describe("(admin) layout · sidebar preference", () => {
  test("hands the stored preference to SidebarProvider, before any render", async () => {
    cookieValue = "1";
    const element = await AdminGroupLayout({ children: null });

    expect(element.type).toBe(SidebarProvider);
    expect(element.props.defaultCollapsed).toBe(true);
  });

  test("defaults to expanded when no cookie has been set yet", async () => {
    cookieValue = undefined;
    const element = await AdminGroupLayout({ children: null });

    expect(element.props.defaultCollapsed).toBe(false);
  });

  test("turns the library's own localStorage persistence off", async () => {
    // Both would race, and localStorage is exactly the source the server
    // cannot read — leaving it on is how the mismatch comes back.
    cookieValue = "0";
    const element = await AdminGroupLayout({ children: null });

    expect(element.props.storageKey).toBeNull();
  });

  test("renders the writer alongside the children it wraps", async () => {
    cookieValue = "0";
    const element = await AdminGroupLayout({ children: <p>contenido</p> });
    const [writer, wrapped] = element.props.children as React.ReactElement[];

    expect(writer.type).toBe(SidebarPreference);
    expect(wrapped.type).toBe("p");
  });
});

describe("SidebarPreference", () => {
  function renderWriter(collapsed: boolean) {
    return render(
      <SidebarProvider defaultCollapsed={collapsed} storageKey={null}>
        <SidebarPreference />
        <SidebarTrigger label="toggle" />
      </SidebarProvider>
    );
  }

  test("writes the current state on mount, so the server agrees from the first load", () => {
    renderWriter(true);
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=1`);
  });

  test("follows the sidebar when it is toggled", () => {
    const { getByRole } = renderWriter(false);
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=0`);

    fireEvent.click(getByRole("button", { name: "toggle" }));
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=1`);

    fireEvent.click(getByRole("button", { name: "toggle" }));
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=0`);
  });

  test("renders nothing of its own", () => {
    const { container } = render(
      <SidebarProvider defaultCollapsed={false} storageKey={null}>
        <SidebarPreference />
      </SidebarProvider>
    );
    expect(container.innerHTML).toBe("");
  });
});
