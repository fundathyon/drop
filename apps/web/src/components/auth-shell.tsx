import { Icon } from "@/components/icon";
import { useTranslations } from "next-intl";

// Port of the split-screen shell shared by login.html/setup.html: a brand
// panel (hidden below the same breakpoint) beside the form itself.
export function AuthShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  return (
    <div className="flex min-h-svh w-full">
      <div className="hidden flex-1 flex-col items-center justify-center gap-4 bg-primary text-primary-foreground p-10 min-[60rem]:flex">
        <Icon name="package" className="size-10" />
        <p className="max-w-xs text-center text-lg">{t("tagline")}</p>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
