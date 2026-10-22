"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CONSENT_OPEN_EVENT, loadGaWithConsent, storeConsent, storedConsent, withdrawConsent } from "@/lib/track";

/**
 * Cookie banner for Google Analytics 4 only (lib/track.ts). Nothing from Google loads before Accept.
 * The choice is remembered in localStorage (try/catch: storage may be blocked), under the key the
 * simulator reads too. The footer's "Cookie settings" and the privacy page open it again: Decline then
 * withdraws a consent given before. Decline and Accept have the same visual weight (T6).
 */
export default function ConsentBanner() {
  const t = useTranslations("consent");
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const stored = storedConsent();
    if (stored === "yes") loadGaWithConsent();
    else if (stored !== "no") setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

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
      role="region"
      aria-label={t("title")}
      className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-lg rounded-xl border border-line bg-surface p-4 shadow-2xl sm:bottom-4 sm:left-auto sm:right-4"
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
