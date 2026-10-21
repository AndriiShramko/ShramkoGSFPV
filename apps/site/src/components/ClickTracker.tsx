"use client";
import { useEffect } from "react";
import { routing, type Locale } from "@/i18n/routing";
import { rememberLocale } from "@/lib/locale";
import { countPageView, ctaLocation, gaEvent, isTrackEvent, openConsent, track } from "@/lib/track";

/**
 * One delegated listener instead of many client islands:
 *  - <a data-lang="pl">                     → remember NEXT_LOCALE + lang_switch
 *  - <a data-track="cta_click" data-p="…">  → whitelisted event (unknown names are dropped)
 *  - <a data-consent="open">                → the consent banner again (without JS: the privacy page)
 *  - [data-share], [data-share-action], [data-ga="…"] → GA4 only: share {method}, a named click (copy_agent_prompt)
 * The links themselves are plain server-rendered <a href>, so they work with JS off.
 * Also, once per page: the server-side page_view, and for GA4 only (nothing before consent, lib/track.ts)
 * section_view {section_id} when half of a section[id] is on screen, form_start {form_id} on the first
 * focus in a form[data-form], and exception {description} for this site's own script errors.
 */
export default function ClickTracker() {
  useEffect(() => {
    countPageView(document.documentElement.lang);
    const onClick = (ev: MouseEvent) => {
      const target = ev.target as Element | null;
      const consent = target?.closest<HTMLElement>("[data-consent='open']");
      if (consent) {
        ev.preventDefault();
        openConsent();
        return;
      }
      const share = target?.closest<HTMLElement>("[data-share],[data-share-action]");
      if (share) gaEvent("share", { method: (share.dataset.share ?? share.dataset.shareAction ?? "other").slice(0, 20), cta_location: share.closest("footer") ? "footer" : "hero" });
      const named = target?.closest<HTMLElement>("[data-ga]")?.dataset.ga ?? "";
      if (/^[a-z_]{3,40}$/.test(named)) gaEvent(named, { cta_location: ctaLocation(target) });
      const el = target?.closest<HTMLElement>("[data-track],[data-lang]");
      if (!el) return;
      const lang = el.dataset.lang;
      if (lang && (routing.locales as readonly string[]).includes(lang)) {
        rememberLocale(lang as Locale);
        if (lang !== document.documentElement.lang) track("lang_switch", lang, el);
        return;
      }
      const name = el.dataset.track ?? "";
      if (isTrackEvent(name)) track(name, el.dataset.p ?? "", el);
    };
    const started = new Set<string>();
    const onFocus = (ev: FocusEvent) => {
      const form = (ev.target as Element | null)?.closest<HTMLFormElement>("form[data-form]");
      const id = form?.dataset.form;
      if (!id || started.has(id)) return;
      if (gaEvent("form_start", { form_id: id })) started.add(id);
    };
    const onError = (ev: ErrorEvent) => {
      // only this site's own scripts: an extension's or a third party's error is not ours to count
      if (ev.filename && !ev.filename.startsWith(location.origin)) return;
      const name = ev.error instanceof Error ? ev.error.name : "Error";
      const text = String(ev.message || name).replace(/https?:\/\/\S+/g, "<url>");
      gaEvent("exception", { description: text.slice(0, 100), fatal: false });
    };
    document.addEventListener("click", onClick);
    document.addEventListener("focusin", onFocus);
    window.addEventListener("error", onError);
    let io: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      const seen = new Set<string>();
      // seen = half of the section on screen, or (a section taller than two screens never gets to half)
      // the section covering half of the screen; the extra thresholds let a tall one report on the way
      io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            const id = (en.target as HTMLElement).id;
            if (!en.isIntersecting || !id || seen.has(id)) continue;
            const screen = en.rootBounds?.height ?? window.innerHeight;
            if (en.intersectionRatio < 0.5 && en.intersectionRect.height < screen * 0.5) continue;
            // before consent nothing is sent and the section is not marked: it counts when seen again after Accept
            if (gaEvent("section_view", { section_id: id.slice(0, 40) })) seen.add(id);
          }
        },
        { threshold: [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5] },
      );
      document.querySelectorAll("main section[id]").forEach((s) => io!.observe(s));
    }
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("error", onError);
      io?.disconnect();
    };
  }, []);
  return null;
}
