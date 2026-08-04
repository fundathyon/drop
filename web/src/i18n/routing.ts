import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
  // "es" is every existing string in the admin today, so it keeps the plain
  // (unprefixed) URLs; only "en" gets a /en prefix.
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
