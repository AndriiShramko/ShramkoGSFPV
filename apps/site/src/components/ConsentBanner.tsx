"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { consentDock, type ConsentDock } from "@/lib/consent-dock";
import { CONSENT_OPEN_EVENT, loadGaWithConsent, storeConsent, storedConsent, withdrawConsent } from "@/lib/track";

/**
 * Cookie banner for Google Analytics 4 only (lib/track.ts). Nothing from Google loads before Accept.
 * The choice is remembered in localStorage (try/catch: storage may be blocked), under the key the
 * simulator reads too. The footer's "Cookie settings" and the privacy page open it again: Decline then
 * withdraws a consent given before. Decline and Accept have the same visual weight (T6).
 * It never lies over the page's main button (`data-keep-clear`): lib/consent-dock.ts picks the bottom or the place under the
 * header, again on resize and scroll.
 */
export default function ConsentBanner() {
  const t = useTranslations("consent");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [dock, setDock] = useState<ConsentDock>("bottom");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = storedConsent();
    if (stored === "yes") loadGaWithConsent();
    else if (stored !== "no") setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = box.current;
      if (!el) return;
      // the gaps of the bottom place below: bottom-20 under 640 px (above the phone's bottom bar), bottom-4 from 640 px
      const gap = window.matchMedia("(min-width: 640px)").matches ? 16 : 80;
      const headerBottom = (document.querySelector("header")?.getBoundingClientRect().bottom ?? 0) + 8;
      const keep = [...document.querySelectorAll("[data-keep-clear]")].map((k) => k.getBoundingClientRect()).filter((r) => r.height > 0);
      setDock(consentDock(window.innerHeight, el.offsetHeight, gap, headerBottom, keep.map((r) => ({ top: r.top, bottom: r.bottom }))));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [open]);

  if (!open) return null;

  const decide = (yes: boolean) => {
    setOpen(false);
    if (yes) {
      storeConsent("yes");
      loadGaWithConsent();
    } else withdrawConsent();
  };

  return (
    <div
      ref={box}
      role="region"
      aria-label={t("title")}
      data-consent-dock={dock}
      className={`fixed inset-x-3 z-50 mx-auto max-w-lg rounded-xl border border-line bg-surface p-4 shadow-2xl sm:left-auto sm:right-4 ${dock === "top" ? "top-[4.5rem]" : "bottom-20 sm:bottom-4"}`}
    >
      <p className="text-sm text-muted">
        <strong className="text-ink">{t("title")}</strong> {t("text")}{" "}
        <a href={`/${locale}/privacy/`} className="link">
          {t("more")}
        </a>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => decide(false)} className="btn-primary px-5">
          {t("decline")}
        </button>
        <button type="button" onClick={() => decide(true)} className="btn-primary px-5">
          {t("accept")}
        </button>
      </div>
    </div>
  );
}
