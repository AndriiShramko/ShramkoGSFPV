"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { GA_ID, loadGaWithConsent } from "@/lib/track";

const KEY = "gsfpv_consent";

/**
 * Cookie banner for Google Analytics 4 only. Rendered only when NEXT_PUBLIC_GA_ID was set at
 * build time; with no ID there is no banner and nothing from Google is loaded.
 * The choice is remembered in localStorage (try/catch: storage may be blocked).
 */
export default function ConsentBanner() {
  const t = useTranslations("consent");
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!GA_ID) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      stored = null;
    }
    if (stored === "yes") loadGaWithConsent();
    else if (stored !== "no") setOpen(true);
  }, []);

  if (!GA_ID || !open) return null;

  const decide = (yes: boolean) => {
    try {
      localStorage.setItem(KEY, yes ? "yes" : "no");
    } catch {
      /* ignore */
    }
    setOpen(false);
    if (yes) loadGaWithConsent();
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
        <button type="button" onClick={() => decide(false)} className="btn-secondary px-5">
          {t("decline")}
        </button>
        <button type="button" onClick={() => decide(true)} className="btn-primary px-5">
          {t("accept")}
        </button>
      </div>
    </div>
  );
}
