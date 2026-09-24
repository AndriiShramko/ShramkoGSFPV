import { useTranslations } from "next-intl";
import { flyPath } from "@/config/site";
import type { Locale } from "@/i18n/routing";
import LangSwitcher from "./LangSwitcher";
import Logo from "./Logo";

const ANCHORS = ["how", "real", "numbers", "scenes", "radios", "faq", "contact"] as const;

/** Sticky header: brand, section anchors (desktop), language switcher and the "Fly now" CTA. */
export default function Header({ locale, page, onLanding }: { locale: Locale; page: string; onLanding: boolean }) {
  const t = useTranslations("nav");
  const base = onLanding ? "" : `/${locale}/`;
  return (
    <>
    <a href="#main" className="skip-link">
      {t("skip")}
    </a>
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-8">
        <a href={onLanding ? "#top" : `/${locale}/`} className="flex min-h-11 items-center gap-2 text-[15px] font-semibold tracking-tight text-ink" aria-label={t("home")}>
          <Logo />
          <span>ShramkoGSFPV</span>
        </a>
        <nav aria-label={t("sections")} className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {ANCHORS.map((a) => (
              <li key={a}>
                <a href={`${base}#${a}`} className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted hover:text-ink">
                  {t(`anchors.${a}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-2">
          <LangSwitcher locale={locale} page={page} label={t("language")} where="nav" />
          <a href={flyPath(locale)} data-track="fly_click" className="btn-primary hidden min-h-11 px-4 text-sm md:inline-flex">
            {t("fly")}
          </a>
        </div>
      </div>
    </header>
    </>
  );
}
