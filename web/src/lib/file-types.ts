import {
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileText,
  FileType,
  type LucideIcon,
} from 'lucide-react';

export interface FileTypeInfo {
  /** Short label shown as a badge. */
  label: string;
  Icon: LucideIcon;
  /** Tailwind text colour for the icon. */
  className: string;
  /** Editor language id; mapped to a grammar in CodeEditor. */
  language: string;
  /** Whether the contents are text we can safely open in the editor. */
  editable: boolean;
  /** Whether the file can be previewed as an image. */
  image: boolean;
  contentType: string;
}

const UNKNOWN: FileTypeInfo = {
  label: 'FILE',
  Icon: File,
  className: 'text-muted-foreground',
  language: 'plaintext',
  editable: false,
  image: false,
  contentType: 'application/octet-stream',
};

const TYPES: Record<string, FileTypeInfo> = {
  html: { label: 'HTML', Icon: FileCode, className: 'text-orange-500', language: 'html', editable: true, image: false, contentType: 'text/html' },
  css: { label: 'CSS', Icon: FileCode, className: 'text-sky-500', language: 'css', editable: true, image: false, contentType: 'text/css' },
  js: { label: 'JS', Icon: FileCode, className: 'text-yellow-500', language: 'javascript', editable: true, image: false, contentType: 'text/javascript' },
  ts: { label: 'TS', Icon: FileCode, className: 'text-blue-500', language: 'typescript', editable: true, image: false, contentType: 'text/typescript' },
  jsx: { label: 'JSX', Icon: FileCode, className: 'text-cyan-500', language: 'javascript', editable: true, image: false, contentType: 'text/javascript' },
  tsx: { label: 'TSX', Icon: FileCode, className: 'text-cyan-500', language: 'typescript', editable: true, image: false, contentType: 'text/typescript' },
  json: { label: 'JSON', Icon: FileJson, className: 'text-amber-500', language: 'json', editable: true, image: false, contentType: 'application/json' },
  md: { label: 'MD', Icon: FileText, className: 'text-slate-500', language: 'markdown', editable: true, image: false, contentType: 'text/markdown' },
  txt: { label: 'TXT', Icon: FileText, className: 'text-muted-foreground', language: 'plaintext', editable: true, image: false, contentType: 'text/plain' },
  yaml: { label: 'YAML', Icon: FileCog, className: 'text-violet-500', language: 'yaml', editable: true, image: false, contentType: 'application/yaml' },
  svg: { label: 'SVG', Icon: FileImage, className: 'text-emerald-500', language: 'xml', editable: true, image: true, contentType: 'image/svg+xml' },
  xml: { label: 'XML', Icon: FileCode, className: 'text-emerald-600', language: 'xml', editable: true, image: false, contentType: 'application/xml' },
  png: { label: 'PNG', Icon: FileImage, className: 'text-emerald-500', language: 'plaintext', editable: false, image: true, contentType: 'image/png' },
  jpg: { label: 'JPG', Icon: FileImage, className: 'text-emerald-500', language: 'plaintext', editable: false, image: true, contentType: 'image/jpeg' },
  gif: { label: 'GIF', Icon: FileImage, className: 'text-emerald-500', language: 'plaintext', editable: false, image: true, contentType: 'image/gif' },
  webp: { label: 'WEBP', Icon: FileImage, className: 'text-emerald-500', language: 'plaintext', editable: false, image: true, contentType: 'image/webp' },
  ico: { label: 'ICO', Icon: FileImage, className: 'text-emerald-500', language: 'plaintext', editable: false, image: true, contentType: 'image/x-icon' },
  pdf: { label: 'PDF', Icon: FileText, className: 'text-red-500', language: 'plaintext', editable: false, image: false, contentType: 'application/pdf' },
  zip: { label: 'ZIP', Icon: FileArchive, className: 'text-muted-foreground', language: 'plaintext', editable: false, image: false, contentType: 'application/zip' },
  woff: { label: 'FONT', Icon: FileType, className: 'text-muted-foreground', language: 'plaintext', editable: false, image: false, contentType: 'font/woff' },
  woff2: { label: 'FONT', Icon: FileType, className: 'text-muted-foreground', language: 'plaintext', editable: false, image: false, contentType: 'font/woff2' },
};

const ALIASES: Record<string, string> = {
  htm: 'html',
  mjs: 'js',
  cjs: 'js',
  jpeg: 'jpg',
  yml: 'yaml',
  markdown: 'md',
  ttf: 'woff',
  otf: 'woff',
};

/**
 * Classifies a file by name. The `.drop` descriptor has no extension, so it is
 * matched by name and treated as the YAML it is.
 */
export function fileType(name: string): FileTypeInfo {
  if (name === '.drop') {
    return { ...TYPES.yaml!, label: 'DROP', className: 'text-primary' };
  }
  const raw = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  const key = ALIASES[raw] ?? raw;
  return TYPES[key] ?? { ...UNKNOWN, label: raw ? raw.toUpperCase() : UNKNOWN.label };
}
