import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { REPO_BLOB } from "@/config/site";
import type { Locale } from "@/i18n/routing";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import JsonLd from "@/components/JsonLd";
import StickyCTA from "@/components/StickyCTA";
import { Ext } from "@/components/kit";
import { pageMetadata } from "@/lib/meta";

type Lic = { name: string; license: string; d: string; href: string };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "licenses" });
  return pageMetadata({ locale: locale as Locale, page: "licenses/", title: t("title"), description: t("description") });
}

function Licenses({ locale }: { locale: Locale }) {
  const t = useTranslations();
  const items = t.raw("licenses.items") as Lic[];
  return (
    <>
      <JsonLd locale={locale} description={t("meta.description")} />
      <Header locale={locale} page="licenses/" onLanding={false} />
      <main id="main" tabIndex={-1} className="outline-none">
        <div className="relative isolate overflow-hidden border-b border-line">
          <div aria-hidden="true" className="hero-fallback absolute inset-0 -z-10" />
          <div className="mx-auto max-w-4xl px-4 pb-10 pt-16 sm:px-8 sm:pt-24">
            <p className="eyebrow">{t("licenses.eyebrow")}</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{t("licenses.h1")}</h1>
            <p className="mt-4 max-w-2xl text-lg text-muted">{t("licenses.lead")}</p>
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-8">
          <ul className="divide-y divide-line rounded-xl border border-line">
            {items.map((x) => (
              <li key={x.name} className="grid gap-2 p-5 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-6 sm:p-6">
                <div>
                  <h2 className="text-lg font-semibold text-ink">
                    <Ext href={x.href} className="link">
                      {x.name}
                    </Ext>
                  </h2>
                  <p className="mt-1 font-mono text-sm text-accent">{x.license}</p>
                </div>
                <p className="text-ink/85">{x.d}</p>
              </li>
            ))}
          </ul>
          <section className="mt-10">
            <h2 className="text-2xl font-semibold tracking-tight text-ink">{t("licenses.scenesTitle")}</h2>
            <p className="mt-3 text-ink/85">{t("licenses.scenes")}</p>
          </section>
          <section className="mt-10">
            <h2 className="text-2xl font-semibold tracking-tight text-ink">{t("licenses.trademarksTitle")}</h2>
            <p className="mt-3 text-ink/85">{t("footer.disclaimer")}</p>
          </section>
          <p className="mt-10 flex flex-wrap gap-x-6 text-sm">
            <Ext href={`${REPO_BLOB}/LICENSE`} className="link inline-flex min-h-11 items-center">
              LICENSE
            </Ext>
            <Ext href={`${REPO_BLOB}/NOTICE`} className="link inline-flex min-h-11 items-center">
              NOTICE
            </Ext>
            <Ext href={`${REPO_BLOB}/docs/PROVENANCE.md`} className="link inline-flex min-h-11 items-center">
              PROVENANCE.md
            </Ext>
          </p>
        </div>
      </main>
      <Footer locale={locale} page="licenses/" />
      <StickyCTA locale={locale} label={t("sticky.cta")} note={t("sticky.note")} />
    </>
  );
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  return <Licenses locale={locale as Locale} />;
}
