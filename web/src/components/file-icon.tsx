import { Icon } from "@/components/icon";
import { typeOf } from "@/lib/filetype";
import { cn } from "@/lib/utils";

export function FileIcon({ name, className }: { name: string; className?: string }) {
  const type = typeOf(name);
  return <Icon name={type.icon} className={cn("size-4", type.accentClass, className)} />;
}
