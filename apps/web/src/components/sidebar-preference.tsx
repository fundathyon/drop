"use client";

import { useEffect } from "react";
import { useSidebar } from "@foundathyon/community-ui";
import { SIDEBAR_COOKIE, SIDEBAR_COOKIE_MAX_AGE } from "@/lib/sidebar";

/**
 * Persists the sidebar collapse state — §12 asks for the preference to be
 * remembered per user and product, and Drop turns the library's own
 * localStorage persistence off (see lib/sidebar.ts for why) so this is what
 * remembers it.
 *
 * Renders nothing. It only mirrors the context into the cookie the server
 * reads on the next request.
 */
export function SidebarPreference() {
  const { collapsed } = useSidebar();

  useEffect(() => {
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
  }, [collapsed]);

  return null;
}
