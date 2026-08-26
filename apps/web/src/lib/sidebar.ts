/**
 * Where the sidebar collapse preference lives.
 *
 * A cookie, deliberately, and not localStorage — which is what
 * SidebarProvider's own `storageKey` uses and why Drop passes `storageKey:
 * null` and drives `defaultCollapsed` itself.
 *
 * The reason is hydration. The preference has to be known during the SERVER
 * render, because the sidebar's width is baked into the HTML
 * (`w-sidebar` vs `w-sidebar-collapsed`). Read from localStorage, the server
 * always renders "expanded" while a returning browser hydrates "collapsed" —
 * and React 19 does not warn about that, it THROWS
 * (`throwOnHydrationMismatch`) and discards the whole tree to re-render on
 * the client. A cookie travels with the request, so both renders agree.
 */
export const SIDEBAR_COOKIE = "drop-sidebar";

/** One year, in seconds — a UI preference, not a session. */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
