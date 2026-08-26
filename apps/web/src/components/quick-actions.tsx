"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Copy, Download, FileText, FolderOpen, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Icon,
  useToast,
} from "@foundathyon/community-ui";
import { getPathname, useRouter } from "@/i18n/navigation";
import { ConfirmAction, type ActionResult } from "@/components/confirm-action";

export type QuickActionsKind = "folder" | "drop" | "file";

/**
 * The design system sizes ContextMenu for roomy application menus: 13px labels
 * on 32px rows, 180px wide before the first character. Right-clicking a file
 * browser puts that menu directly on top of a dense grid of tiles, where it
 * reads as a slab. These three overrides take it down to the density of the
 * listing underneath — 12px on 26px rows — and let it start narrower.
 *
 * Only the density moves. Radius, border, shadow and the hover/danger tokens
 * are left to the library so the popup still belongs to the same system as
 * every other surface (§05: 8px popover, 6px menu item).
 */
const MENU_CONTENT = "min-w-40";
const MENU_ITEM = "px-2 py-1 text-body-sm whitespace-nowrap";
/** Icons carry the row, they do not lead it — destructive keeps `text-danger`. */
const MENU_ICON = "text-text-muted";

export interface QuickActionsProps {
  /**
   * The row or tile the menu belongs to, substituted into the trigger rather
   * than wrapped by it. Base UI's ContextMenuTrigger renders a `<div>` by
   * default, and a `<div>` between `<tbody>` and `<tr>` is invalid markup the
   * browser silently reparents — which moves every row out of the table.
   */
  render: ReactElement;
  children: ReactNode;
  name: string;
  kind: QuickActionsKind;
  /** Where the item opens — the same destination clicking it already has. */
  openHref: string;
  /** Raw URL served by the Go API. Present only for real files. */
  downloadHref?: string;
  /**
   * Bound Server Action. Omit for items the user cannot delete — something
   * shared with them, or a file the API generates — and the destructive item
   * (and its separator) simply does not render.
   */
  deleteAction?: () => Promise<ActionResult | void>;
  deleteTitle?: string;
  deleteDescription?: string;
}

/**
 * Right-click quick actions for a file, folder or drop (§12: same rules as any
 * menu — at most 7 items, destructive last, separated, and always opening a
 * confirmation).
 *
 * Every action here is one that already exists elsewhere on the page; the menu
 * is a shortcut to them, never the only way to reach one. Right-click is not
 * discoverable and is not available on touch beyond a long press, so nothing
 * lives exclusively in here.
 */
export function QuickActions({
  render,
  children,
  name,
  kind,
  openHref,
  downloadHref,
  deleteAction,
  deleteTitle,
  deleteDescription,
}: QuickActionsProps) {
  const t = useTranslations("quickActions");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();

  // The confirmation is a sibling of the menu, not a child of it: see the note
  // on ConfirmAction's `trigger`.
  const [confirming, setConfirming] = useState(false);

  // `getPathname` applies the same locale rules as <Link> — with
  // `localePrefix: "as-needed"` an "en" URL needs the /en that "es" must not
  // have. Downloads bypass it: they are served by the Go API, not by Next.
  const shareHref = downloadHref ?? getPathname({ href: openHref, locale });
  const absolute = () => new URL(shareHref, window.location.origin).toString();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(absolute());
      toast({ title: t("copied"), tone: "success" });
    } catch {
      // Clipboard access is refusable and unavailable outside secure contexts.
      toast({ title: t("copyFailed"), tone: "danger" });
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={render}>{children}</ContextMenuTrigger>

        <ContextMenuContent className={MENU_CONTENT} aria-label={t("menuAriaLabel", { name })}>
          <ContextMenuItem className={MENU_ITEM} onClick={() => router.push(openHref)}>
            <Icon icon={kind === "file" ? FileText : FolderOpen} size={14} className={MENU_ICON} />
            {t("open")}
          </ContextMenuItem>

          <ContextMenuItem
            className={MENU_ITEM}
            onClick={() => window.open(absolute(), "_blank", "noopener,noreferrer")}
          >
            <Icon icon={SquareArrowOutUpRight} size={14} className={MENU_ICON} />
            {t("openInNewTab")}
          </ContextMenuItem>

          {downloadHref && (
            <ContextMenuItem
              className={MENU_ITEM}
              onClick={() => window.open(downloadHref, "_blank", "noopener,noreferrer")}
            >
              <Icon icon={Download} size={14} className={MENU_ICON} />
              {t("download")}
            </ContextMenuItem>
          )}

          <ContextMenuItem className={MENU_ITEM} onClick={copy}>
            <Icon icon={Copy} size={14} className={MENU_ICON} />
            {t(downloadHref ? "copyDownloadLink" : "copyLink")}
          </ContextMenuItem>

          {deleteAction && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem destructive className={MENU_ITEM} onClick={() => setConfirming(true)}>
                <Icon icon={Trash2} size={14} />
                {t(kind === "drop" ? "deleteDrop" : kind === "file" ? "deleteFile" : "deleteFolder")}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {deleteAction && (
        <ConfirmAction
          open={confirming}
          onOpenChange={setConfirming}
          title={deleteTitle ?? ""}
          description={deleteDescription ?? ""}
          action={deleteAction}
        />
      )}
    </>
  );
}
