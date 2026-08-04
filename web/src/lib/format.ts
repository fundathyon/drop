// Ports of the Go template helpers in api/internal/adminui/adminui.go, so the
// two frontends (while both existed) and now this one agree byte-for-byte.

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (const u of units) {
    unit = u;
    if (value < 1024) break;
    value /= 1024;
  }
  return `${value.toFixed(1)} ${unit}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

export function lastSegment(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

// A catch-all route's params (e.g. path: string[]) arrive with each segment
// still percent-encoded — Next only decodes those for getStaticPaths-style
// SSG matching, not for App Router params. Joining them raw and handing the
// result to the API client double-encodes anything with a space or other
// reserved character (query()'s URLSearchParams turns the literal "%20"
// into "%2520"), so every consumer of a catch-all path has to decode first.
export function decodePathSegments(segments: string[]): string {
  return segments
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}
