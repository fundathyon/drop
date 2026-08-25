import { Icon } from "@/components/icon";
import { ACCENT_TEXT, typeOf } from "@/lib/filetype";
import { cn } from "@/lib/utils";

// The small, inline version — a table cell, a breadcrumb, a dialog header.
// For the large macOS-style artwork use DocumentIcon from components/finder-icon.
export function FileIcon({ name, className }: { name: string; className?: string }) {
  const type = typeOf(name);
  return <Icon name={type.icon} size={14} className={cn(ACCENT_TEXT[type.accent], className)} />;
}
