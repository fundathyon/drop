import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GLOBALS = readFileSync(join(import.meta.dir, "..", "globals.css"), "utf8");

// The package is ESM-only with an `exports` map, so `require.resolve` cannot
// see it; `import.meta.resolve` follows the same conditions the app does. The
// barrel is only re-exports, so read the two modules that carry the classes.
const DIST = join(fileURLToPath(import.meta.resolve("@foundathyon/community-ui")), "..");
const POPUPS = ["dialog", "confirm-dialog"].map((name) => ({
  name,
  source: readFileSync(join(DIST, "components", "overlays", `${name}.js`), "utf8"),
}));

/**
 * A layout bug cannot be caught by this suite: happy-dom parses CSS but never
 * lays anything out, so `getBoundingClientRect()` is all zeros and a dialog
 * pinned to the top of the viewport measures exactly like a centered one.
 *
 * So these guard the fix rather than the geometry — they make sure the
 * override is not quietly deleted, and, more usefully, they say when it is
 * safe to delete because upstream fixed the cause.
 */
describe("modal centering override", () => {
  test("globals.css restores `bottom` for modal popups above the sm breakpoint", () => {
    const block = GLOBALS.slice(GLOBALS.indexOf("/* Modal centering"));
    expect(block).toContain("@media (min-width: 40rem)");
    expect(block).toContain("bottom: 0");
  });

  test("it covers Dialog and ConfirmDialog, which use different roles", () => {
    // Base UI gives AlertDialog `role="alertdialog"`, so a rule written only
    // for `dialog` would centre the six dialogs and leave every destructive
    // confirmation hanging from the top.
    const block = GLOBALS.slice(GLOBALS.indexOf("/* Modal centering"));
    expect(block).toContain('[role="dialog"].fdn-z-modal');
    expect(block).toContain('[role="alertdialog"].fdn-z-modal');
  });

  test("it is scoped tightly enough to leave popovers alone", () => {
    // Base UI also gives Popover `role="dialog"` and emits no `aria-modal`, so
    // the role on its own is not a modal test. `.fdn-z-modal` is what separates
    // them — a popover carries `.fdn-z-dropdown` and is placed by a Positioner
    // that `bottom: 0` would fight.
    const block = GLOBALS.slice(GLOBALS.indexOf("/* Modal centering"));
    const selectors = block.slice(block.indexOf("@media")).match(/\[role="[a-z]+"\][^,{]*/g) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector).toContain(".fdn-z-modal");
    }
  });

  test("the override is still needed — community-ui still emits sm:bottom-auto", () => {
    // When this fails, the cause was fixed upstream: delete the "Modal
    // centering" block from globals.css and this suite with it.
    const stillBroken = POPUPS.filter((p) => p.source.includes("sm:bottom-auto")).map((p) => p.name);
    expect(stillBroken).toEqual(["dialog", "confirm-dialog"]);
  });
});
