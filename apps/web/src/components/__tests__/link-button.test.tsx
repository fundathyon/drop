import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { LinkButton } from "../link-button";

function renderLink(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="es" messages={{}}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("LinkButton", () => {
  test("renders an in-app link that carries the button classes", () => {
    renderLink(<LinkButton href="/compartido">Compartido</LinkButton>);

    const link = screen.getByRole("link", { name: "Compartido" });
    expect(link).toHaveAttribute("href", "/compartido");
    // The exact utilities are the design system's business; what matters here
    // is that the variant was resolved at all rather than left unstyled.
    expect(link.className).toContain("inline-flex");
    expect(link).not.toHaveAttribute("target");
  });

  test("opens external targets in a new tab, with rel noreferrer", () => {
    renderLink(
      <LinkButton href="https://drop.test/raw/index.html" external>
        Descargar
      </LinkButton>
    );

    const link = screen.getByRole("link", { name: "Descargar" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  test("forwards arbitrary anchor props, so callers keep their aria labels", () => {
    renderLink(
      <LinkButton href="/?view=list" aria-label="Vista de lista" aria-current="true">
        <span aria-hidden="true">☰</span>
      </LinkButton>
    );

    const link = screen.getByRole("link", { name: "Vista de lista" });
    expect(link).toHaveAttribute("aria-current", "true");
  });
});

/**
 * `buttonVariants` is exported from community-ui's `actions/button` module,
 * which is marked "use client". Calling it while rendering a server component
 * throws at request time ("Attempted to call buttonVariants() from the
 * server") — and nothing else catches it: typecheck, lint and the build all
 * pass, because the pages that used it are dynamic and only render behind a
 * session. LinkButton is the one place allowed to call it.
 */
describe("no server component calls buttonVariants", () => {
  const SRC = join(import.meta.dir, "..", "..");
  const ALLOWED = join(SRC, "components", "link-button.tsx");

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return full.endsWith(".tsx") || full.endsWith(".ts") ? [full] : [];
    });
  }

  test("every buttonVariants call site is a client module", () => {
    const offenders = walk(SRC)
      .filter((file) => file !== ALLOWED)
      .filter((file) => !file.includes("__tests__"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        // A mention inside a comment is harmless; an import is what runs.
        const imports = /import\s*\{[^}]*\bbuttonVariants\b[^}]*\}/.test(source);
        return imports && !source.trimStart().startsWith('"use client"');
      })
      .map((file) => file.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });
});
