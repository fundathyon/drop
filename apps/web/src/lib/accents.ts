/**
 * Swappable accent colors.
 *
 * The numbers live in `globals.css`, in `[data-accent="…"]` blocks that set
 * only the three variables community-ui derives every accent token from
 * (`--fdn-accent-hue`, `-l`, `-c`). Everything else — accent-solid and its
 * hover/active stops, accent-text, the washes, the focus ring, the login
 * screen's orbs — falls out of those by `oklch()`/`color-mix()`, so switching
 * the attribute repaints the whole app. Only the list and its labels live
 * here, so a color is never spelled twice.
 *
 * This is a tool for testing the palette, not a reader preference: the picker
 * is only mounted while `SHOW_ACCENT_PICKER` is on (see `flags.ts`).
 */

export const ACCENT_IDS = [
  "red",
  "orange",
  "amber",
  "lime",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "magenta",
  "pink",
] as const;

export type AccentId = (typeof ACCENT_IDS)[number];

/** Drop's own identity — what gets served when nobody has chosen anything. */
export const DEFAULT_ACCENT: AccentId = "blue";

export const ACCENT_STORAGE_KEY = "drop-accent";

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === "string" && (ACCENT_IDS as readonly string[]).includes(value);
}

/**
 * Applies the stored accent before the first frame. Injected into `<head>`
 * next to community-ui's own ThemeScript, and for the same reason: waiting for
 * React to hydrate would show one paint of the default accent first. Writing
 * nothing when there is no stored value is deliberate — the CSS default and
 * the SSR'd `--fdn-accent-*` on `<html>` already agree on blue.
 */
export const ACCENT_INIT_SCRIPT = `(function(){try{var a=localStorage.getItem(${JSON.stringify(
  ACCENT_STORAGE_KEY
)});if(${JSON.stringify(
  ACCENT_IDS as readonly string[]
)}.indexOf(a)>-1){document.documentElement.dataset.accent=a}}catch(e){}})()`;
