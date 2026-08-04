// Decides where a "shared with me" row links to. Drops open in the drop
// viewer, folders open in the explorer — both browsed as the sharer's
// content via the `owner` query param the explorer route already supports.
import type { Kind } from "@/lib/types";

export function sharedNodeHref(kind: Kind, path: string, owner: number): string {
  const base = kind === "drop" ? `/drop/${path}` : `/${path}`;
  return `${base}?owner=${owner}`;
}
