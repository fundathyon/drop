// Port of api/internal/adminui/filetypes.go. `icon`/`accentClass` name the
// same lucide icon and CSS accent token the Go admin used; see
// components/file-icon.tsx for how they're rendered.

export interface FileType {
  label: string;
  icon: string;
  accentClass: string;
  editable: boolean;
  image: boolean;
  contentType: string;
}

const unknownType: Omit<FileType, "label"> = {
  icon: "file",
  accentClass: "text-muted-foreground",
  editable: false,
  image: false,
  contentType: "application/octet-stream",
};

interface Row {
  label: string;
  icon: string;
  accentClass: string;
  editable?: boolean;
  image?: boolean;
  contentType: string;
}

const fileTypes: Record<string, Row> = {
  html: { label: "HTML", icon: "file-code", accentClass: "text-ft-orange", editable: true, contentType: "text/html" },
  css: { label: "CSS", icon: "file-code", accentClass: "text-ft-sky", editable: true, contentType: "text/css" },
  js: { label: "JS", icon: "file-code", accentClass: "text-ft-yellow", editable: true, contentType: "text/javascript" },
  ts: { label: "TS", icon: "file-code", accentClass: "text-ft-blue", editable: true, contentType: "text/typescript" },
  jsx: { label: "JSX", icon: "file-code", accentClass: "text-ft-cyan", editable: true, contentType: "text/javascript" },
  tsx: { label: "TSX", icon: "file-code", accentClass: "text-ft-cyan", editable: true, contentType: "text/typescript" },
  json: { label: "JSON", icon: "file-json", accentClass: "text-ft-amber", editable: true, contentType: "application/json" },
  md: { label: "MD", icon: "file-text", accentClass: "text-ft-slate", editable: true, contentType: "text/markdown" },
  txt: { label: "TXT", icon: "file-text", accentClass: "text-muted-foreground", editable: true, contentType: "text/plain" },
  yaml: { label: "YAML", icon: "file-cog", accentClass: "text-ft-violet", editable: true, contentType: "application/yaml" },
  svg: { label: "SVG", icon: "file-image", accentClass: "text-ft-emerald", editable: true, image: true, contentType: "image/svg+xml" },
  xml: { label: "XML", icon: "file-code", accentClass: "text-ft-emerald", editable: true, contentType: "application/xml" },
  png: { label: "PNG", icon: "file-image", accentClass: "text-ft-emerald", image: true, contentType: "image/png" },
  jpg: { label: "JPG", icon: "file-image", accentClass: "text-ft-emerald", image: true, contentType: "image/jpeg" },
  gif: { label: "GIF", icon: "file-image", accentClass: "text-ft-emerald", image: true, contentType: "image/gif" },
  webp: { label: "WEBP", icon: "file-image", accentClass: "text-ft-emerald", image: true, contentType: "image/webp" },
  ico: { label: "ICO", icon: "file-image", accentClass: "text-ft-emerald", image: true, contentType: "image/x-icon" },
  pdf: { label: "PDF", icon: "file-text", accentClass: "text-ft-red", contentType: "application/pdf" },
  zip: { label: "ZIP", icon: "file-archive", accentClass: "text-muted-foreground", contentType: "application/zip" },
  woff: { label: "FONT", icon: "file-type", accentClass: "text-muted-foreground", contentType: "font/woff" },
  woff2: { label: "FONT", icon: "file-type", accentClass: "text-muted-foreground", contentType: "font/woff2" },
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
      accentClass: "text-primary",
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
