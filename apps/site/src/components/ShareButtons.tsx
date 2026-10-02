"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import shareTargets from "@gsfpv/i18n/share.json";
import { SITE } from "@/config/site";

/**
 * Share the landing (hero and footer): the Web Share API where the browser has it (phones: that is
 * how Instagram and messengers are reached), then LinkedIn, Facebook, X, Telegram, WhatsApp, Reddit
 * (packages/i18n/locales/share.json, the simulator uses the same list) and Copy link. The link is the
 * page's canonical address, so the preview is the landing's Open Graph card (scripts/og.mjs).
 */
export default function ShareButtons({ where }: { where: "hero" | "footer" }) {
  const t = useTranslations("share");
  const locale = useLocale();
  const [native, setNative] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setNative(typeof navigator.share === "function"), []);

  const url = `${SITE}/${locale}/`;
  const text = t("text");
  const title = "ShramkoGSFPV";
  const href = (h: string) => h.replace("{url}", encodeURIComponent(url)).replace("{text}", encodeURIComponent(text)).replace("{title}", encodeURIComponent(title));
  const pill = "inline-flex min-h-11 items-center rounded-full border border-line-strong px-3.5 text-sm text-ink hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt(t("copy"), url);
    }
  }

  return (
    <div role="group" aria-label={t("label")} data-testid={`share-${where}`} className={where === "hero" ? "mt-6" : "mt-5"}>
      <p className={where === "hero" ? "text-sm text-muted" : "mb-1 text-xs uppercase tracking-wider text-muted"}>{where === "hero" ? t("hero") : t("footer")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {native ? (
          <button
            type="button"
            className={`${pill} border-accent text-accent`}
            onClick={() => {
              navigator.share({ title, text, url }).catch(() => undefined);
            }}
          >
            {t("native")}
          </button>
        ) : null}
        {shareTargets.targets.map((s) => (
          <a key={s.id} className={pill} href={href(s.href)} target="_blank" rel="noopener noreferrer" data-share={s.id}>
            {s.label}
          </a>
        ))}
        <button type="button" className={pill} onClick={copy} aria-live="polite">
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
    </div>
  );
}
