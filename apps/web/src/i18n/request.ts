import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

// Each namespace lives in its own file so independent pages/features never
// touch the same file — see messages/<locale>/*.json.
const namespaces = ["common", "nav", "auth", "explorer", "drop", "editor", "shared", "sharing", "users", "quick-actions"];

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  const modules = await Promise.all(
    namespaces.map((ns) => import(`../../messages/${locale}/${ns}.json`))
  );
  const messages = Object.assign({}, ...modules.map((m) => m.default));

  return { locale, messages };
});
