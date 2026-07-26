/** Presentation helpers shared across the explorer. */

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Short, human-facing label for a file's type, used as a badge. */
export function fileKind(name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (!ext) return 'file';
  const known: Record<string, string> = {
    html: 'HTML',
    htm: 'HTML',
    css: 'CSS',
    js: 'JS',
    mjs: 'JS',
    ts: 'TS',
    json: 'JSON',
    md: 'MD',
    svg: 'SVG',
    png: 'PNG',
    jpg: 'JPG',
    jpeg: 'JPG',
    gif: 'GIF',
    webp: 'WEBP',
    ico: 'ICO',
    woff: 'FONT',
    woff2: 'FONT',
    pdf: 'PDF',
    txt: 'TXT',
    yaml: 'YAML',
    yml: 'YAML',
  };
  return known[ext] ?? ext.toUpperCase();
}

export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}
