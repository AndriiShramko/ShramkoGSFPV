import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AUTHOR } from "@/config/site";
import type { Locale } from "@/i18n/routing";
import ConsentReset from "@/components/ConsentReset";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import JsonLd from "@/components/JsonLd";
import StickyCTA from "@/components/StickyCTA";
import { Ext } from "@/components/kit";
import { pageMetadata } from "@/lib/meta";

type Block = { h: string; p: string[] };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacy" });
  return pageMetadata({ locale: locale as Locale, page: "privacy/", title: t("title"), description: t("description") });
}

function Privacy({ locale }: { locale: Locale }) {
  const t = useTranslations();
  const blocks = t.raw("privacy.sections") as Block[];
  return (
    <>
      <JsonLd locale={locale} description={t("meta.description")} />
      <Header locale={locale} page="privacy/" onLanding={false} />
      <main id="main" tabIndex={-1} className="outline-none">
        <div className="relative isolate overflow-hidden border-b border-line">
          <div aria-hidden="true" className="hero-fallback absolute inset-0 -z-10" />
          <div className="mx-auto max-w-3xl px-4 pb-10 pt-16 sm:px-8 sm:pt-24">
            <p className="eyebrow">{t("privacy.eyebrow")}</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{t("privacy.h1")}</h1>
            <p className="mt-4 text-muted">{t("privacy.updated")}</p>
            <p className="mt-4 inline-flex rounded-md border border-warn/50 px-3 py-1.5 text-sm text-warn">{t("privacy.review")}</p>
          </div>
        </div>
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-8">
          {blocks.map((b) => (
            <section key={b.h} className="mt-10 first:mt-0">
              <h2 className="text-2xl font-semibold tracking-tight text-ink">{b.h}</h2>
              {b.p.map((p, i) => (
                <p key={i} className="mt-3 text-ink/85">
                  {p}
                </p>
              ))}
            </section>
          ))}
          <ConsentReset label={t("privacy.resetConsent")} done={t("privacy.resetDone")} />
          <section className="mt-12 rounded-xl border border-line bg-surface p-6">
            <h2 className="text-lg font-semibold text-ink">{t("privacy.contactTitle")}</h2>
            <ul className="mt-3 space-y-1">
              <li>
                <a href={`mailto:${AUTHOR.email}`} data-track="cta_click" data-p="email" className="link inline-flex min-h-11 items-center">
                  {AUTHOR.email}
                </a>
              </li>
              <li>
                <a href={`/${locale}/#contact`} className="link inline-flex min-h-11 items-center">
                  {t("privacy.formLink")}
                </a>
              </li>
              <li>
                <Ext href="https://uodo.gov.pl/" className="link inline-flex min-h-11 items-center">
                  {t("privacy.uodoLink")}
                </Ext>
              </li>
            </ul>
          </section>
        </div>
      </main>
      <Footer locale={locale} page="privacy/" />
      <StickyCTA locale={locale} label={t("sticky.cta")} note={t("sticky.note")} />
    </>
  );
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  return <Privacy locale={locale as Locale} />;
}
