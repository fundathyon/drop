import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The badge the API injects into published pages.
 *
 * It lives in apps/api — plain browser JS embedded into the Go binary with
 * `go:embed`, no build step and no framework — and this is the repo's only
 * JavaScript test runner, so the test comes to it. What Go covers is the
 * INJECTION (widget_test.go: that the snippet lands before </body> and the
 * payload is escaped); what nothing covered until now is the panel itself,
 * which only exists once someone opens it.
 */
const WIDGET = readFileSync(
  join(import.meta.dir, "..", "..", "..", "api", "internal", "httpapi", "assets", "widget.js"),
  "utf8"
);

const DROP = {
  slug: "lEgj83Aa",
  title: "Catálogo de planes",
  entrypoint: "index.html",
  visibility: "public",
  version: 2,
  current: 2,
  pinned: false,
  url: "https://drop.foundathyon.com/d/lEgj83Aa",
  created_at: "2026-08-03T11:16:53.000Z",
  updated_at: "2026-08-25T13:27:49.000Z",
  files: [
    { name: "index.html", size: 95027, type: "text/html; charset=utf-8" },
    { name: "styles.css", size: 4210, type: "text/css" },
    { name: "hero.png", size: 250880, type: "image/png" },
  ],
  versions: [
    { seq: 2, files: 3, size: 350117, current: true, url: "https://drop.foundathyon.com/d/lEgj83Aa", published_at: "2026-08-25T13:27:49.000Z" },
    { seq: 1, files: 1, size: 29594, current: false, url: "https://drop.foundathyon.com/d/lEgj83Aa/v/1", published_at: "2026-08-03T11:16:53.000Z" },
  ],
};

// The panel is inside a CLOSED shadow root, which is exactly right for a badge
// dropped into someone else's page and exactly wrong for a test. Capturing the
// root at attachShadow is the only way in, and it changes nothing about what
// the code does.
let shadow: ShadowRoot;

function mount(meta: unknown = DROP) {
  document.body.innerHTML = "";
  if (meta !== null) {
    const script = document.createElement("script");
    script.type = "application/json";
    script.id = "__drop_meta";
    script.textContent = JSON.stringify(meta);
    document.body.appendChild(script);
  }

  const original = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function patched(this: Element, init: ShadowRootInit) {
    const root = original.call(this, { ...init, mode: "open" });
    shadow = root;
    return root;
  };
  try {
    new Function(WIDGET)();
  } finally {
    Element.prototype.attachShadow = original;
  }
  return shadow;
}

const $ = (sel: string) => shadow.querySelector(sel);
const $$ = (sel: string) => [...shadow.querySelectorAll(sel)];
const rowValue = (key: string) =>
  $$(".row").find((r) => r.querySelector(".k")?.textContent === key)?.querySelector(".v")?.textContent?.trim();
const visibleTab = () => $$('[role="tabpanel"]').find((p) => !(p as HTMLElement).hidden)!;

let execResult = true;
const copied: string[] = [];

/**
 * The details tab mounts a real <iframe src="index.html">, and happy-dom is
 * faithful enough to go and fetch it — against a localhost with nothing
 * listening, once per mount. Nothing here asserts on what the frame CONTAINS,
 * only on what it points at, so the refusals are dropped. Narrowly: anything
 * that is not this exact resource-loading complaint still reaches the console.
 */
const realConsoleError = console.error;
const isResourceNoise = (value: unknown) => {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  return /ECONNREFUSED|Failed to (load|perform)/i.test(text);
};
console.error = (...args: unknown[]) => {
  if (args.some(isResourceNoise)) return;
  realConsoleError(...args);
};

beforeEach(() => {
  copied.length = 0;
  execResult = true;
  // Clipboard API is refused in an opaque origin, which is what the published
  // page is; execCommand is the path that actually runs there.
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  (document as unknown as { execCommand: () => boolean }).execCommand = () => {
    copied.push(document.querySelector("textarea")?.value ?? "");
    return execResult;
  };
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("drop badge · mounting", () => {
  test("does nothing without a payload", () => {
    const before = document.body.innerHTML;
    mount(null);
    expect(document.body.innerHTML).toBe(before);
  });

  test("does nothing when the payload has no slug", () => {
    mount({ title: "sin slug" });
    expect(document.querySelector("[data-drop-badge]")).toBeNull();
  });

  /**
   * The details tab previews the drop's own entrypoint in an iframe. Without
   * this guard that preview loads a page which injects this same script, which
   * previews itself — recursively, until the browser gives up.
   */
  test("refuses to run inside a frame, so the preview cannot recurse", () => {
    const realTop = window.top;
    Object.defineProperty(window, "top", { value: { name: "not-me" }, configurable: true });
    try {
      mount();
      expect(document.querySelector("[data-drop-badge]")).toBeNull();
    } finally {
      Object.defineProperty(window, "top", { value: realTop, configurable: true });
    }
  });

  test("mounts closed, and opens from the edge toggle", () => {
    mount();
    const root = $(".root")!;
    const toggle = $(".toggle") as HTMLButtonElement;

    expect(root.classList.contains("open")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    toggle.click();
    expect(root.classList.contains("open")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("drop badge · identity", () => {
  test("leads with the title, the version, the visibility and the type", () => {
    mount();
    expect($(".title")!.textContent).toBe("Catálogo de planes");
    expect($$(".badge").map((b) => b.textContent)).toEqual(["v2", "público", "HTML"]);
  });

  test("an image entrypoint is identified as one", () => {
    mount({ ...DROP, entrypoint: "hero.png" });
    expect($$(".badge").map((b) => b.textContent)).toContain("Imagen");
  });

  test("warns, and offers the way back, when an old version is pinned", () => {
    mount({ ...DROP, pinned: true, version: 1, current: 2 });
    const notice = $(".notice")!;
    expect(notice.textContent).toContain("versión 1");
    expect(notice.querySelector("a")!.getAttribute("href")).toBe(DROP.url);
    expect($$(".badge").map((b) => b.textContent)).toContain("versión anclada");
  });
});

describe("drop badge · tabs", () => {
  test("three tabs, one panel visible, the selected one alone in the tab order", () => {
    mount();
    const tabs = $$('[role="tab"]') as HTMLButtonElement[];
    expect(tabs.map((t) => t.textContent)).toEqual(["Detalles", "Historial", "Archivos"]);

    expect($$('[role="tabpanel"]').filter((p) => !(p as HTMLElement).hidden)).toHaveLength(1);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  test("each tab points at the panel it labels", () => {
    mount();
    for (const tab of $$('[role="tab"]')) {
      const panel = shadow.getElementById(tab.getAttribute("aria-controls")!)!;
      expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    }
  });

  test("arrow keys move between tabs and wrap around", () => {
    mount();
    const tablist = $(".tabs")!;
    const selected = () => $$('[role="tab"]').findIndex((t) => t.getAttribute("aria-selected") === "true");

    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(selected()).toBe(1);
    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(selected()).toBe(2);
    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(selected()).toBe(0);
  });

  test("clicking a tab swaps which panel is shown", () => {
    mount();
    ($$('[role="tab"]')[2] as HTMLButtonElement).click();
    expect(visibleTab().textContent).toContain("3 archivos");
  });
});

describe("drop badge · details", () => {
  test("shows the general information the panel is for", () => {
    mount();
    expect(rowValue("Slug")).toBe("lEgj83Aa");
    expect(rowValue("Entrypoint")).toBe("index.html");
    expect(rowValue("Visibilidad")).toBe("Público");
    expect(rowValue("Tipo")).toBe("HTML");
    // The size of the version being served, not the sum of the listed files:
    // the ".drop" descriptor is filtered out of the listing but still weighs.
    expect(rowValue("Tamaño")).toBe("341.9 KB");
  });

  test("the link row is a real link, truncated for display only", () => {
    mount();
    const link = $$(".row").find((r) => r.querySelector(".k")?.textContent === "Enlace")!.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(DROP.url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(link.textContent).toBe("drop.foundathyon.com/d/lEgj83Aa");
  });

  test("visibility carries a tone, not just a word", () => {
    mount({ ...DROP, visibility: "private" });
    expect(rowValue("Visibilidad")).toBe("Privado");
    expect($(".dot.off")).toBeTruthy();
    mount({ ...DROP, visibility: "unlisted" });
    expect(rowValue("Visibilidad")).toBe("No listado");
    expect($(".dot.warn")).toBeTruthy();
  });

  test("previews the entrypoint, and offers to open it", () => {
    mount();
    const frame = $(".shot iframe") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("index.html");
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(frame.tabIndex).toBe(-1);
    expect(($(".preview .act") as HTMLAnchorElement).getAttribute("href")).toBe(DROP.url);
  });

  test("an image entrypoint previews as an image, not a frame", () => {
    mount({ ...DROP, entrypoint: "hero.png" });
    expect($(".shot img")!.getAttribute("src")).toBe("hero.png");
    expect($(".shot iframe")).toBeNull();
  });

  test("says so rather than showing an empty box when nothing can be previewed", () => {
    mount({
      ...DROP,
      entrypoint: "bundle.zip",
      files: [{ name: "bundle.zip", size: 1024, type: "application/zip" }],
    });
    expect($(".shot.empty")!.textContent).toContain("Sin vista previa");
  });

  test("'Ver todas' hands over to the history tab", () => {
    mount({ ...DROP, versions: [...DROP.versions, { ...DROP.versions[1], seq: 0 }] });
    ($(".more") as HTMLButtonElement).click();
    expect(visibleTab().textContent).toContain("3 versiones");
  });
});

describe("drop badge · files and history", () => {
  test("lists every file with its size, and marks the entrypoint", () => {
    mount();
    ($$('[role="tab"]')[2] as HTMLButtonElement).click();

    const rows = $$(".files li");
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector("a")!.getAttribute("href")).toBe("index.html");
    expect(rows[0].querySelector(".entry")).toBeTruthy();
    expect(rows[1].querySelector(".entry")).toBeNull();
    expect(rows[2].querySelector(".size")!.textContent).toBe("245.0 KB");
  });

  test("file links stay relative, so a pinned version keeps serving its own snapshot", () => {
    mount();
    ($$('[role="tab"]')[2] as HTMLButtonElement).click();
    for (const link of $$(".files a")) {
      expect(link.getAttribute("href")!.startsWith("http")).toBe(false);
      expect(link.getAttribute("href")!.startsWith("/")).toBe(false);
    }
  });

  test("every version is listed, with the served one marked as current", () => {
    mount();
    ($$('[role="tab"]')[1] as HTMLButtonElement).click();

    // Scoped to the visible panel: the details tab shows a two-version peek of
    // the same history, so an unscoped query counts both lists.
    const links = [...visibleTab().querySelectorAll(".versions a")];
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("aria-current")).toBe("true");
    expect(links[0].textContent).toContain("actual");
    expect(links[1].textContent).toContain("1 archivo");
  });

  test("an empty drop says so instead of rendering a bare heading", () => {
    mount({ ...DROP, files: [], versions: [] });
    ($$('[role="tab"]')[2] as HTMLButtonElement).click();
    expect(visibleTab().textContent).toContain("no sirve ningún archivo");
  });
});

describe("drop badge · actions", () => {
  /**
   * This runs on the PUBLIC page, for whoever opened the URL: no session, no
   * way to reach the API from an opaque origin, and no guarantee the reader
   * owns anything. Anything that mutates belongs in the admin.
   */
  test("offers nothing destructive", () => {
    mount();
    const text = shadow.textContent ?? "";
    for (const word of ["Eliminar", "Borrar", "Clonar", "Duplicar", "Editar"]) {
      expect(text).not.toContain(word);
    }
    expect($$("form")).toHaveLength(0);
  });

  test("copies the link through execCommand, since the API is refused here", async () => {
    mount();
    const button = $$(".btn").find((b) => b.textContent?.includes("Copiar"))! as HTMLButtonElement;
    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(copied).toEqual([DROP.url]);
    expect(button.textContent).toContain("Enlace copiado");
  });

  test("says it failed rather than pretending it worked", async () => {
    execResult = false;
    mount();
    const button = $$(".btn").find((b) => b.textContent?.includes("Copiar"))! as HTMLButtonElement;
    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(button.textContent).toContain("No se pudo copiar");
  });

  test("the copy control leaves no textarea behind in the host page", async () => {
    mount();
    ($$(".btn").find((b) => b.textContent?.includes("Copiar")) as HTMLButtonElement).click();
    await Promise.resolve();
    expect(document.querySelector("textarea")).toBeNull();
  });
});
