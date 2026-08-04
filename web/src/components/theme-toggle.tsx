"use client";

import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

// Both icons are always in the DOM; CSS (not JS state) decides which one
// shows, driven by the `dark` class next-themes' inline script already sets
// before hydration — so there is no light/dark flash and no "mounted" guard.
export function ThemeToggle({ ariaLabel }: { ariaLabel: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={ariaLabel}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Icon name="sun" className="hidden dark:block" />
      <Icon name="moon" className="block dark:hidden" />
    </Button>
  );
}
