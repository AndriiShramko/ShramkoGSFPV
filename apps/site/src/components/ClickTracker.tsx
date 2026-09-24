"use client";
import { useEffect } from "react";
import { routing, type Locale } from "@/i18n/routing";
import { rememberLocale } from "@/lib/locale";
import { isTrackEvent, track } from "@/lib/track";

/**
 * One delegated listener instead of many client islands:
 *  - <a data-lang="pl">                     → remember NEXT_LOCALE + lang_switch
 *  - <a data-track="cta_click" data-p="…">  → whitelisted event (unknown names are dropped)
 * The links themselves are plain server-rendered <a href>, so they work with JS off.
 */
export default function ClickTracker() {
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      const el = (ev.target as Element | null)?.closest<HTMLElement>("[data-track],[data-lang]");
      if (!el) return;
      const lang = el.dataset.lang;
      if (lang && (routing.locales as readonly string[]).includes(lang)) {
        rememberLocale(lang as Locale);
        if (lang !== document.documentElement.lang) track("lang_switch", lang);
        return;
      }
      const name = el.dataset.track ?? "";
      if (isTrackEvent(name)) track(name, el.dataset.p ?? "");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
