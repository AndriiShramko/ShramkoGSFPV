import type { Locale } from "@/i18n/routing";

/** Shared with the simulator (/{locale}/fly/) and read by nginx on "/". */
export const LANG_COOKIE = "NEXT_LOCALE";

/** Remember the visitor's explicit choice for a year. */
export function rememberLocale(locale: Locale) {
  try {
    document.cookie = `${LANG_COOKIE}=${locale}; max-age=31536000; path=/; samesite=lax`;
  } catch {
    /* cookies blocked — the URL prefix still carries the locale */
  }
}
