import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import {
  FoundathyonProvider,
  Table,
  TableBody,
  TableCell,
  TableRow,
  ToastProvider,
  TooltipProvider,
} from "@foundathyon/community-ui";

const push = mock((href: string) => href);
mock.module("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace: mock(() => {}), refresh: mock(() => {}) }),
  // The real one applies `localePrefix: "as-needed"`: no prefix for "es",
  // "/en" for "en". The menu builds its shareable URL through it, so the mock
  // has to keep that behaviour rather than echo the href back.
  getPathname: ({ href, locale }: { href: string; locale: string }) =>
    locale === "es" ? href : `/${locale}${href}`,
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const { QuickActions } = await import("../quick-actions");

const messages = {
  common: { delete: "Eliminar", cancel: "Cancelar" },
  quickActions: {
    menuAriaLabel: "Acciones rápidas para {name}",
    open: "Abrir",
    openInNewTab: "Abrir en una pestaña nueva",
    download: "Descargar",
    copyLink: "Copiar enlace",
    copyDownloadLink: "Copiar enlace de descarga",
    copied: "Enlace copiado",
    copyFailed: "No se pudo copiar el enlace",
    deleteFolder: "Eliminar carpeta",
    deleteDrop: "Eliminar drop",
    deleteFile: "Eliminar archivo",
  },
};

let originalClipboard: Clipboard | undefined;
let originalOpen: typeof window.open;
const opened: string[] = [];

beforeEach(() => {
  push.mockClear();
  opened.length = 0;
  originalClipboard = navigator.clipboard;
  originalOpen = window.open;
  window.open = mock((url?: string | URL) => {
    opened.push(String(url));
    return null;
  }) as unknown as typeof window.open;
});

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
  window.open = originalOpen;
});

type Props = Partial<React.ComponentProps<typeof QuickActions>>;

function renderRow(props: Props = {}, locale = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <FoundathyonProvider>
        <TooltipProvider>
          <ToastProvider>
            <Table>
              <TableBody>
                <QuickActions
                  render={<TableRow interactive />}
                  name="Proyectos"
                  kind="folder"
                  openHref="/Proyectos"
                  {...props}
                >
                  <TableCell>Proyectos</TableCell>
                </QuickActions>
              </TableBody>
            </Table>
          </ToastProvider>
        </TooltipProvider>
      </FoundathyonProvider>
    </NextIntlClientProvider>
  );
}

function openMenu(container: HTMLElement) {
  const row = container.querySelector("tr")!;
  fireEvent.contextMenu(row);
  return row;
}

const items = () => screen.getAllByRole("menuitem").map((i) => i.textContent?.trim());

describe("QuickActions", () => {
  /**
   * The trigger renders a <div> unless it is told otherwise, and a <div>
   * between <tbody> and <tr> is invalid markup a browser silently reparents —
   * every row would be lifted out of the table. `render` substitution is what
   * keeps the row a row, so this is the first thing to prove.
   */
  test("substitutes into the row instead of wrapping it in a div", () => {
    const { container } = renderRow();

    const tbody = container.querySelector("tbody")!;
    expect([...tbody.children].map((c) => c.tagName)).toEqual(["TR"]);
    expect(container.querySelector("tbody div")).toBeNull();
    expect(container.querySelector("tr")!.textContent).toContain("Proyectos");
  });

  test("opens on right click and names itself after the item", async () => {
    const { container } = renderRow();
    expect(screen.queryByRole("menu")).toBeNull();

    openMenu(container);

    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    expect(screen.getByRole("menu").getAttribute("aria-label")).toBe("Acciones rápidas para Proyectos");
  });

  test("a folder offers open, new tab, copy and delete — in that order", async () => {
    const { container } = renderRow({ deleteAction: async () => {}, deleteTitle: "¿Eliminar?", deleteDescription: "…" });
    openMenu(container);

    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    expect(items()).toEqual(["Abrir", "Abrir en una pestaña nueva", "Copiar enlace", "Eliminar carpeta"]);
  });

  test("a file adds Descargar and copies the download link instead", async () => {
    const { container } = renderRow({
      kind: "file",
      name: "index.html",
      openHref: "/admin/edit?path=sitio&name=index.html",
      downloadHref: "/api/files?path=sitio%2Findex.html",
    });
    openMenu(container);

    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    expect(items()).toEqual(["Abrir", "Abrir en una pestaña nueva", "Descargar", "Copiar enlace de descarga"]);
  });

  test("without a delete action there is no destructive item and no separator", async () => {
    // Shared-with-me: the node belongs to someone else at any access level.
    const { container } = renderRow();
    openMenu(container);

    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    expect(items()).toEqual(["Abrir", "Abrir en una pestaña nueva", "Copiar enlace"]);
    expect(screen.queryByRole("separator")).toBeNull();
  });

  test("Abrir routes in-app, so the locale prefix is the router's business", async () => {
    const { container } = renderRow();
    openMenu(container);

    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    fireEvent.click(screen.getByText("Abrir"));

    expect(push).toHaveBeenCalledWith("/Proyectos");
  });

  test("the new tab and the copied link carry the locale prefix", async () => {
    const writeText = mock(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const { container } = renderRow({}, "en");
    openMenu(container);
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());

    fireEvent.click(screen.getByText("Abrir en una pestaña nueva"));
    expect(opened[0]).toBe("http://localhost/en/Proyectos");

    openMenu(container);
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    fireEvent.click(screen.getByText("Copiar enlace"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost/en/Proyectos"));
  });

  test("a download link is the API's, so it never gets a locale prefix", async () => {
    const writeText = mock(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const { container } = renderRow(
      { kind: "file", name: "a.txt", openHref: "/admin/edit", downloadHref: "/api/files?path=a.txt" },
      "en"
    );
    openMenu(container);
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());

    fireEvent.click(screen.getByText("Copiar enlace de descarga"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost/api/files?path=a.txt"));
  });

  test("a refused clipboard is reported, not swallowed", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => { throw new Error("denied"); } },
      configurable: true,
    });

    const { container } = renderRow();
    openMenu(container);
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    fireEvent.click(screen.getByText("Copiar enlace"));

    expect(await screen.findByText("No se pudo copiar el enlace")).toBeTruthy();
  });

  /**
   * The destructive item cannot BE the dialog's trigger: the menu unmounts its
   * items on close, which would tear the trigger — and the dialog with it —
   * out of the tree before it ever painted. The confirmation is a sibling
   * driven by state, and this is what proves it survives the close.
   */
  test("deleting asks for confirmation, and the dialog outlives the menu", async () => {
    const deleteAction = mock(async () => {});
    const { container } = renderRow({
      deleteAction,
      deleteTitle: "¿Eliminar esta carpeta?",
      deleteDescription: 'Se eliminará "Proyectos".',
    });

    openMenu(container);
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    fireEvent.click(screen.getByText("Eliminar carpeta"));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("¿Eliminar esta carpeta?");
    expect(deleteAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(deleteAction).toHaveBeenCalledTimes(1));
  });
});
