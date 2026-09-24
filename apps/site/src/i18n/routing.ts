import { defineRouting } from "next-intl/routing";
import common from "@gsfpv/i18n/common.json";

// Static export: every locale lives under its own prefix (/en/ /es/ /pl/ /ru/).
// The bare "/" is redirected by nginx from the NEXT_LOCALE cookie or Accept-Language.
export const routing = defineRouting({
  locales: ["en", "es", "pl", "ru"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];

// endonyms live with the other translations (packages/i18n/locales)
export const LOCALE_NAMES: Record<Locale, string> = common.localeNames;

export const OG_LOCALE: Record<Locale, string> = {
  en: "en_US",
  es: "es_ES",
  pl: "pl_PL",
  ru: "ru_RU",
};
