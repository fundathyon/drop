// Port of api/internal/adminui/filetypes.go. `icon`/`accent` name the lucide
// glyph and the color token the Go admin used; components/file-icon.tsx renders
// the small inline version and components/finder-icon.tsx the large macOS-style
// document art.

import type { IconName } from "@/components/icon";

/**
 * Color tokens a file kind can carry. `accent` is the product accent, reserved
 * for `.drop` itself — the manifest is Drop's own artifact, not a generic file.
 * Everything else uses the `--ft-*` palette (globals.css), which exists so a
 * file is recognizable by kind at a glance; the product accent must never be
 * spent on categorization.
 */
export type FileAccent =
  | "ft-orange"
  | "ft-sky"
  | "ft-yellow"
  | "ft-blue"
  | "ft-cyan"
  | "ft-amber"
  | "ft-slate"
  | "ft-violet"
  | "ft-emerald"
  | "ft-red"
  | "ft-neutral"
  | "accent";

// Tailwind only generates classes it can read literally in the source, so these
// pairs are spelled out instead of assembled from the token name at runtime.
export const ACCENT_TEXT: Record<FileAccent, string> = {
  "ft-orange": "text-ft-orange",
  "ft-sky": "text-ft-sky",
  "ft-yellow": "text-ft-yellow",
  "ft-blue": "text-ft-blue",
  "ft-cyan": "text-ft-cyan",
  "ft-amber": "text-ft-amber",
  "ft-slate": "text-ft-slate",
  "ft-violet": "text-ft-violet",
  "ft-emerald": "text-ft-emerald",
  "ft-red": "text-ft-red",
  "ft-neutral": "text-text-muted",
  accent: "text-accent",
};

export const ACCENT_FILL: Record<FileAccent, string> = {
  "ft-orange": "fill-ft-orange",
  "ft-sky": "fill-ft-sky",
  "ft-yellow": "fill-ft-yellow",
  "ft-blue": "fill-ft-blue",
  "ft-cyan": "fill-ft-cyan",
  "ft-amber": "fill-ft-amber",
  "ft-slate": "fill-ft-slate",
  "ft-violet": "fill-ft-violet",
  "ft-emerald": "fill-ft-emerald",
  "ft-red": "fill-ft-red",
  "ft-neutral": "fill-text-muted",
  accent: "fill-accent",
};

export interface FileType {
  label: string;
  icon: IconName;
  accent: FileAccent;
  editable: boolean;
  image: boolean;
  contentType: string;
}

const unknownType: Omit<FileType, "label"> = {
  icon: "file",
  accent: "ft-neutral",
  editable: false,
  image: false,
  contentType: "application/octet-stream",
};

interface Row {
  label: string;
  icon: IconName;
  accent: FileAccent;
  editable?: boolean;
  image?: boolean;
  contentType: string;
}

const fileTypes: Record<string, Row> = {
  html: { label: "HTML", icon: "file-code", accent: "ft-orange", editable: true, contentType: "text/html" },
  css: { label: "CSS", icon: "file-code", accent: "ft-sky", editable: true, contentType: "text/css" },
  js: { label: "JS", icon: "file-code", accent: "ft-yellow", editable: true, contentType: "text/javascript" },
  ts: { label: "TS", icon: "file-code", accent: "ft-blue", editable: true, contentType: "text/typescript" },
  jsx: { label: "JSX", icon: "file-code", accent: "ft-cyan", editable: true, contentType: "text/javascript" },
  tsx: { label: "TSX", icon: "file-code", accent: "ft-cyan", editable: true, contentType: "text/typescript" },
  json: { label: "JSON", icon: "file-json", accent: "ft-amber", editable: true, contentType: "application/json" },
  md: { label: "MD", icon: "file-text", accent: "ft-slate", editable: true, contentType: "text/markdown" },
  txt: { label: "TXT", icon: "file-text", accent: "ft-neutral", editable: true, contentType: "text/plain" },
  yaml: { label: "YAML", icon: "file-cog", accent: "ft-violet", editable: true, contentType: "application/yaml" },
  svg: { label: "SVG", icon: "file-image", accent: "ft-emerald", editable: true, image: true, contentType: "image/svg+xml" },
  xml: { label: "XML", icon: "file-code", accent: "ft-emerald", editable: true, contentType: "application/xml" },
  png: { label: "PNG", icon: "file-image", accent: "ft-emerald", image: true, contentType: "image/png" },
  jpg: { label: "JPG", icon: "file-image", accent: "ft-emerald", image: true, contentType: "image/jpeg" },
  gif: { label: "GIF", icon: "file-image", accent: "ft-emerald", image: true, contentType: "image/gif" },
  webp: { label: "WEBP", icon: "file-image", accent: "ft-emerald", image: true, contentType: "image/webp" },
  ico: { label: "ICO", icon: "file-image", accent: "ft-emerald", image: true, contentType: "image/x-icon" },
  pdf: { label: "PDF", icon: "file-text", accent: "ft-red", contentType: "application/pdf" },
  zip: { label: "ZIP", icon: "file-archive", accent: "ft-neutral", contentType: "application/zip" },
  woff: { label: "FONT", icon: "file-type", accent: "ft-neutral", contentType: "font/woff" },
  woff2: { label: "FONT", icon: "file-type", accent: "ft-neutral", contentType: "font/woff2" },
};

const aliases: Record<string, string> = {
  htm: "html",
  mjs: "js",
  cjs: "js",
  jpeg: "jpg",
  yml: "yaml",
  markdown: "md",
  ttf: "woff",
  otf: "woff",
};

export function typeOf(name: string): FileType {
  if (name === ".drop") {
    return {
      label: "DROP",
      icon: "file-cog",
      accent: "accent",
      editable: true,
      image: false,
      contentType: "application/yaml",
    };
  }

  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  const resolved = aliases[ext] ?? ext;
  const row = fileTypes[resolved];
  if (row) {
    return { editable: false, image: false, ...row };
  }
  return { label: ext ? ext.toUpperCase() : "FILE", ...unknownType };
}
