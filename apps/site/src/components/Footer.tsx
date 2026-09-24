import { useTranslations } from "next-intl";
import { AUTHOR, REPO } from "@/config/site";
import type { Locale } from "@/i18n/routing";
import { Ext } from "./kit";
import LangSwitcher from "./LangSwitcher";
import Logo from "./Logo";

export default function Footer({ locale, page }: { locale: Locale; page: string }) {
  const t = useTranslations("footer");
  const nav = useTranslations("nav");
  const link = "inline-flex min-h-11 items-center text-muted hover:text-ink";
  return (
    <footer className="border-t border-line pb-24 md:pb-0">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Logo />
            ShramkoGSFPV
          </p>
          <p className="mt-3 max-w-sm text-sm text-muted">{t("tagline")}</p>
          <div className="mt-4">
            <p id="footer-lang" className="mb-1 text-xs uppercase tracking-wider text-muted">
              {nav("language")}
            </p>
            <LangSwitcher locale={locale} page={page} label={nav("language")} where="footer" />
          </div>
        </div>
        <nav aria-label={t("linksLabel")}>
          <ul className="space-y-1 text-sm">
            <li>
              <a href={`/${locale}/`} className={link}>
                {t("home")}
              </a>
            </li>
            <li>
              <a href={`/${locale}/privacy/`} className={link}>
                {t("privacy")}
              </a>
            </li>
            <li>
              <a href={`/${locale}/licenses/`} className={link}>
                {t("licenses")}
              </a>
            </li>
            <li>
              <Ext href={REPO} className={link} track="cta_click" p="github">
                GitHub
              </Ext>
            </li>
          </ul>
        </nav>
        <div className="text-sm text-muted">
          <p>{t("disclaimer")}</p>
          <p className="mt-4">
            © 2026{" "}
            <Ext href={AUTHOR.linkedin} className="link" track="cta_click" p="linkedin">
              {AUTHOR.name}
            </Ext>{" "}
            · {t("license")}
          </p>
        </div>
      </div>
    </footer>
  );
}
