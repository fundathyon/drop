import type * as Monaco from "monaco-editor";

/**
 * The single theme the editor ever registers. It is REDEFINED rather than
 * swapped whenever the palette moves, because what changes is the value behind
 * each token, not which token a thing uses — the same rule the rest of the app
 * follows (globals.css: components must not branch on theme).
 */
export const THEME = "drop";

/**
 * Monaco will not take `var(--fdn-…)`. Its theme service parses every color
 * into an internal registry and does its own contrast math on it, so a CSS
 * variable never survives the trip; it wants literal hex.
 *
 * Rather than keep a second, hand-written palette in sync with tokens.css,
 * this resolves the real tokens the only way a browser reliably turns an
 * `oklch()` custom property into channels: set it on a probe element, read the
 * computed color, and paint one pixel with it. Canvas parses every CSS Color 4
 * syntax and hands back plain RGBA, which is exactly the conversion Monaco
 * needs and the platform will not otherwise expose.
 *
 * The probe has to live in the document: the accent lands on <html> as
 * `data-accent`, so a detached node would resolve the wrong palette — or none.
 */
interface Reader {
  /** `#rrggbb`, for the `colors` map. */
  hex(token: string): string;
  /** `#rrggbbaa`. */
  alpha(token: string, percent: number): string;
  /** `rrggbb` with no `#`, which is what `rules[].foreground` wants. */
  raw(token: string): string;
  /** Relative luminance > 0.5, used to pick Monaco's base theme. */
  isLight(token: string): boolean;
  dispose(): void;
}

function openReader(): Reader {
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;opacity:0;pointer-events:none";
  document.body.appendChild(probe);

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const cache = new Map<string, [number, number, number]>();

  const channels = (token: string): [number, number, number] => {
    const hit = cache.get(token);
    if (hit) return hit;

    probe.style.color = `var(${token})`;
    const computed = getComputedStyle(probe).color;

    let rgb: [number, number, number] = [128, 128, 128];
    if (ctx && computed) {
      // A color canvas cannot parse leaves fillStyle untouched, so seed it with
      // a known value first: a failure then reads as this grey rather than as
      // whatever the previous token happened to be.
      ctx.fillStyle = "#808080";
      ctx.fillStyle = computed;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      rgb = [data[0] ?? 128, data[1] ?? 128, data[2] ?? 128];
    }
    cache.set(token, rgb);
    return rgb;
  };

  const raw = (token: string) =>
    channels(token)
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("");

  return {
    raw,
    hex: (token) => `#${raw(token)}`,
    alpha: (token, percent) =>
      `#${raw(token)}${Math.round((percent / 100) * 255)
        .toString(16)
        .padStart(2, "0")}`,
    isLight: (token) => {
      const [r, g, b] = channels(token);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
    },
    dispose: () => probe.remove(),
  };
}

/** Fully transparent — Monaco rejects `transparent` and every other keyword. */
const NONE = "#00000000";

/**
 * Resolve the current palette and (re)apply it to Monaco.
 *
 * Syntax colors deliberately reuse the four semantic hues the design system
 * already spends on meaning — accent for the verb, success for literal text,
 * info for primitives, muted for everything the eye should skip (§20) — rather
 * than importing a stock editor palette. Two consequences worth knowing: the
 * editor follows the user's accent choice from /colores, and code never
 * introduces a color the rest of the UI does not already use.
 */
export function applyTheme(monaco: typeof Monaco): void {
  const read = openReader();
  try {
    const keyword = read.raw("--fdn-accent-text");
    const string = read.raw("--fdn-success-text");
    const primitive = read.raw("--fdn-info-text");
    const muted = read.raw("--fdn-text-muted");
    const secondary = read.raw("--fdn-text-secondary");
    const text = read.raw("--fdn-text");

    monaco.editor.defineTheme(THEME, {
      base: read.isLight("--fdn-bg") ? "vs" : "vs-dark",
      // NOT inherited. Monaco resolves a token to the rule with the longest
      // matching prefix, so with `inherit: true` any scope this list does not
      // name falls through to a more specific rule from `vs-dark` — which is
      // how VS Code's own `#808080` and `#B5CEA8` ended up on HTML delimiters
      // and CSS numbers, next to but not equal to the tokens beside them.
      // Off, everything unnamed lands on the `""` rule instead, and the file
      // can only ever show the colors below (§20).
      //
      // Only the RULES are dropped. The chrome still resolves through
      // Monaco's own registry defaults for the base theme's type, with the
      // `colors` map below on top.
      inherit: false,
      rules: [
        { token: "", foreground: text },
        // §03 forbids italics, including here — the color already says
        // "comment", and mono type slants badly.
        { token: "comment", foreground: muted, fontStyle: "" },
        { token: "delimiter", foreground: muted },
        { token: "metatag", foreground: muted },
        { token: "keyword", foreground: keyword },
        { token: "tag", foreground: keyword },
        { token: "type", foreground: primitive },
        { token: "number", foreground: primitive },
        { token: "constant", foreground: primitive },
        { token: "regexp", foreground: primitive },
        { token: "string", foreground: string },
        { token: "string.escape", foreground: primitive },
        // A JSON/YAML key is a name, not the literal text it looks like.
        { token: "string.key", foreground: secondary },
        { token: "attribute.name", foreground: secondary },
        { token: "attribute.value", foreground: string },
        // CSS puts lengths and hex colors under attribute.value; a number is a
        // number whichever language it is written in.
        { token: "attribute.value.number", foreground: primitive },
        { token: "attribute.value.unit", foreground: primitive },
        { token: "attribute.value.hex", foreground: primitive },
        // Markdown marks up prose rather than syntax: bold gets weight, and
        // emphasis is named here only to state that it does NOT get a slant
        // (§03), since leaving it out would look like an oversight.
        { token: "strong", foreground: text, fontStyle: "bold" },
        { token: "emphasis", foreground: text, fontStyle: "" },
        { token: "string.link", foreground: primitive },
        { token: "variable.md", foreground: secondary },
        { token: "identifier", foreground: text },
        { token: "variable", foreground: text },
        { token: "operator", foreground: secondary },
      ],
      colors: {
        // bg-subtle, not bg: the same surface CodeBlock uses for code, so a
        // file reads the same whether it is being viewed or edited.
        "editor.background": read.hex("--fdn-bg-subtle"),
        "editor.foreground": read.hex("--fdn-text"),
        "editorGutter.background": read.hex("--fdn-bg-subtle"),
        "editorLineNumber.foreground": read.hex("--fdn-text-disabled"),
        "editorLineNumber.activeForeground": read.hex("--fdn-text-secondary"),
        "editorCursor.foreground": read.hex("--fdn-accent-solid"),
        "editor.selectionBackground": read.alpha("--fdn-accent-solid", 30),
        "editor.inactiveSelectionBackground": read.alpha("--fdn-accent-solid", 15),
        "editor.selectionHighlightBackground": read.alpha("--fdn-accent-solid", 15),
        "editor.wordHighlightBackground": read.alpha("--fdn-accent-solid", 15),
        "editor.wordHighlightStrongBackground": read.alpha("--fdn-accent-solid", 22),
        "editor.findMatchBackground": read.alpha("--fdn-accent-solid", 38),
        "editor.findMatchHighlightBackground": read.alpha("--fdn-accent-solid", 20),
        "editor.lineHighlightBackground": read.hex("--fdn-surface"),
        "editor.lineHighlightBorder": NONE,
        "editorIndentGuide.background1": read.hex("--fdn-border"),
        "editorIndentGuide.activeBackground1": read.hex("--fdn-border-strong"),
        "editorWhitespace.foreground": read.hex("--fdn-border"),
        "editorBracketMatch.background": NONE,
        "editorBracketMatch.border": read.hex("--fdn-accent-solid"),
        "editorOverviewRuler.border": NONE,
        "editorError.foreground": read.hex("--fdn-danger-text"),
        "editorWarning.foreground": read.hex("--fdn-warning-text"),
        "editorInfo.foreground": read.hex("--fdn-info-text"),
        // Popups are the design system's raised surface + border (§05: never a
        // shadow on its own).
        "editorWidget.background": read.hex("--fdn-surface-raised"),
        "editorWidget.border": read.hex("--fdn-border"),
        "editorHoverWidget.background": read.hex("--fdn-surface-raised"),
        "editorHoverWidget.border": read.hex("--fdn-border"),
        "editorSuggestWidget.background": read.hex("--fdn-surface-raised"),
        "editorSuggestWidget.border": read.hex("--fdn-border"),
        "editorSuggestWidget.foreground": read.hex("--fdn-text"),
        "editorSuggestWidget.selectedBackground": read.hex("--fdn-surface-hover"),
        "editorSuggestWidget.highlightForeground": read.hex("--fdn-accent-text"),
        "input.background": read.hex("--fdn-surface"),
        "input.foreground": read.hex("--fdn-text"),
        "input.border": read.hex("--fdn-border"),
        "focusBorder": read.hex("--fdn-accent-solid"),
        "scrollbarSlider.background": read.alpha("--fdn-border-strong", 45),
        "scrollbarSlider.hoverBackground": read.alpha("--fdn-border-strong", 70),
        "scrollbarSlider.activeBackground": read.hex("--fdn-border-strong"),
      },
    });
    monaco.editor.setTheme(THEME);
  } finally {
    read.dispose();
  }
}
