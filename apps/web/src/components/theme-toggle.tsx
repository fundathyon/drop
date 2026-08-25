"use client";

import { Moon, Sun } from "lucide-react";
import { IconButton, useTheme } from "@foundathyon/community-ui";

// Two buttons, not one with a swapped icon: `resolvedTheme` is "dark" during
// SSR no matter what the user actually has (the provider can't read
// localStorage or matchMedia on the server), so branching the icon on it would
// either flash the wrong glyph or trip a hydration mismatch. The `light`
// variant does the choosing in CSS instead, off the same `data-fdn-theme`
// attribute ThemeScript sets before first paint. Only one is ever rendered —
// the other is `display:none`, so it is out of the accessibility tree too.
export function ThemeToggle({ ariaLabel }: { ariaLabel: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const toggle = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");

  return (
    <>
      <IconButton icon={Sun} label={ariaLabel} variant="ghost" onClick={toggle} className="light:hidden" />
      <IconButton icon={Moon} label={ariaLabel} variant="ghost" onClick={toggle} className="hidden light:inline-flex" />
    </>
  );
}
