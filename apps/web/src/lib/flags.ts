/**
 * Build-time switches for surfaces that must never reach a real deployment.
 *
 * `NODE_ENV` rather than a custom env var on purpose: the palette tools are
 * developer surfaces, and tying them to the production build is the one gate
 * that cannot be left on by a misconfigured environment.
 */
export const IS_PRODUCTION = process.env.NODE_ENV === "production";

/** The accent picker in the topbar and the /colores palette page. */
export const SHOW_PALETTE_TOOLS = !IS_PRODUCTION;
