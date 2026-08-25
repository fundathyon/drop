"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Check, Palette } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@foundathyon/community-ui";
import { ACCENT_IDS, ACCENT_STORAGE_KEY, DEFAULT_ACCENT, isAccentId, type AccentId } from "@/lib/accents";

/**
 * Topbar accent picker, in the shape of accounts-docs' AccentPicker. It writes
 * `data-accent` on `<html>` and `globals.css` does the rest: every accent token
 * derives from the three variables that attribute sets, so the whole app —
 * sidebar, badges, focus rings, the login screen's orbs — follows in one paint.
 *
 * A tool for testing the palette, not a reader preference: it is only mounted
 * while SHOW_PALETTE_TOOLS is on, i.e. outside production builds.
 */

/** The <html> attribute is the source of truth, so the tick reads it directly. */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-accent"] });
  return () => observer.disconnect();
}

function currentAccent(): AccentId {
  const value = document.documentElement.dataset.accent;
  return isAccentId(value) ? value : DEFAULT_ACCENT;
}

export function AccentPicker() {
  const t = useTranslations("colors");

  // useSyncExternalStore rather than state seeded in an effect: the server
  // cannot know which accent is stored, and this is the one hook with a
  // separate server snapshot, so hydration matches and React re-renders with
  // the real value right after — no flash, no mismatch warning.
  const applied = useSyncExternalStore(subscribe, currentAccent, () => DEFAULT_ACCENT);

  // Choosing sets an intent; the effect below is what actually touches the
  // document and localStorage. Writing them straight from the click handler
  // would mutate values owned outside the component, which the React Compiler
  // lint rejects — and rightly: this way the DOM write is a declared effect of
  // a state change, not a side effect hidden in an event.
  const [chosen, setChosen] = useState<AccentId | null>(null);

  useEffect(() => {
    if (!chosen) return;
    document.documentElement.dataset.accent = chosen;
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, chosen);
    } catch {
      // Storage unavailable (private mode, blocked): the accent still applies
      // for this session, it just will not survive a reload.
    }
  }, [chosen]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<IconButton icon={Palette} label={t("title")} variant="ghost" />} />
      <DropdownMenuContent align="end">
        {/* The label has to live inside a Group: it is Base UI's
            Menu.GroupLabel underneath and reads MenuGroupContext to announce
            which group it names, so on its own it throws rather than degrading. */}
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>{t("title")}</DropdownMenuGroupLabel>

          {/* Two columns: fourteen rows stacked make a menu taller than a lot
              of windows. */}
          <div className="grid grid-cols-2 gap-0.5">
            {ACCENT_IDS.map((id) => (
              <DropdownMenuItem key={id} onClick={() => setChosen(id)}>
                {/* The attribute paints the swatch too — this element redefines
                    the accent variables for its own subtree, so the dot shows
                    the color without it being named a second time in
                    TypeScript. */}
                <span data-accent={id} className="flex min-w-0 flex-1 items-center gap-2">
                  <span aria-hidden="true" className="accentSwatch size-3.5 shrink-0 rounded-full" />
                  <span className="flex-1 truncate">{t(`names.${id}`)}</span>
                </span>
                {id === applied && <Check aria-hidden="true" className="text-text-muted size-3.5 shrink-0" />}
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuGroup>

        <p className="text-text-muted border-border mt-1 border-t px-2 pt-2 pb-1 text-[10px] leading-snug">
          {t("hint")}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
