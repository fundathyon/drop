"use client";

import { useState, type ReactNode, type UIEvent } from "react";
import { Topbar, cn } from "@foundathyon/community-ui";

/**
 * The right-hand column of the shell: the 48px Topbar plus the one scrolling
 * region under it.
 *
 * This exists as a client component for a single reason. Topbar's `elevated`
 * prop is documented as "pass a boolean when the app owns a custom scroll
 * container" — and Drop does: the shell is `h-svh overflow-hidden`, so the
 * WINDOW never scrolls, `main` does. Left to auto-detect, Topbar subscribes to
 * `window.scroll`, reads `scrollY === 0` forever, and the shadow that is
 * supposed to appear once content slides beneath it never arrives.
 */
export function ShellMain({
  leading,
  trailing,
  wide = false,
  children,
}: {
  leading?: ReactNode;
  trailing?: ReactNode;
  /**
   * The page is a tool, not a document: it drops the reading-width cap and
   * manages its own height, so a `flex-1` child of it fills the shell exactly.
   * The code editor is the case. Listings and forms keep the cap — a table
   * stretched across an ultrawide is harder to read, not easier — and keep
   * `min-h-auto`, because letting THEM shrink costs the bottom padding under
   * the last row once the content is taller than the window.
   */
  wide?: boolean;
  children: ReactNode;
}) {
  const [scrolled, setScrolled] = useState(false);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <Topbar leading={leading} trailing={trailing} elevated={scrolled} />

      <main
        onScroll={(event: UIEvent<HTMLElement>) => setScrolled(event.currentTarget.scrollTop > 0)}
        className="flex flex-1 flex-col overflow-y-auto px-4 py-6 md:px-8"
      >
        <div className={cn("mx-auto flex w-full flex-1 flex-col gap-4", wide ? "min-h-0 max-w-none" : "max-w-6xl")}>
          {children}
        </div>
      </main>
    </div>
  );
}
