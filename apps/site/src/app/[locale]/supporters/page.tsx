import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { flyPath } from "@/config/site";
import type { Locale } from "@/i18n/routing";
import AuthorSign from "@/components/AuthorSign";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import JsonLd from "@/components/JsonLd";
import StickyCTA from "@/components/StickyCTA";
import SupporterCard from "@/components/SupporterCard";
import { joinedSupporters } from "@/lib/supporters";
import { pageMetadata } from "@/lib/meta";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "supporters" });
  return pageMetadata({ locale: locale as Locale, page: "supporters/", title: t("title"), description: t("description") });
}

/** The wall: people who tried the simulator and helped it. Drafts made for invited people never appear here. */
function Wall({ locale }: { locale: Locale }) {
  const t = useTranslations();
  const people = joinedSupporters();
  const join = t.raw("supporters.join") as string[];
  const give = t.raw("supporters.give") as string[];
  return (
    <>
      <JsonLd locale={locale} description={t("meta.description")} />
      <Header locale={locale} page="supporters/" onLanding={false} />
      <main id="main" tabIndex={-1} className="outline-none">
        <div className="relative isolate overflow-hidden border-b border-line">
          <div aria-hidden="true" className="hero-fallback absolute inset-0 -z-10" />
          <div className="mx-auto max-w-6xl px-4 pb-10 pt-16 sm:px-8 sm:pt-24">
            <p className="eyebrow">{t("supporters.eyebrow")}</p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{t("supporters.h1")}</h1>
            <p className="mt-4 max-w-2xl text-lg text-muted">{t("supporters.lead")}</p>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-8">
          {people.length ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="supporters-wall">
              {people.map((p) => (
                <li key={p.slug}>
                  <SupporterCard p={p} locale={locale} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-line-strong p-6 sm:p-8" data-testid="supporters-empty">
              <h2 className="text-2xl font-semibold tracking-tight text-ink">{t("supporters.emptyTitle")}</h2>
              <p className="mt-3 max-w-2xl text-ink/85">{t("supporters.emptyBody")}</p>
            </div>
          )}
          <div className="mt-12 grid gap-10 md:grid-cols-2">
            <section aria-labelledby="join-title">
              <h2 id="join-title" className="text-2xl font-semibold tracking-tight text-ink">
                {t("supporters.joinTitle")}
              </h2>
              <ol className="mt-4 space-y-3">
                {join.map((s, i) => (
                  <li key={i} className="flex gap-3 text-ink/85">
                    <span aria-hidden="true" className="font-mono text-accent">
                      {i + 1}
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </section>
            <section aria-labelledby="give-title">
              <h2 id="give-title" className="text-2xl font-semibold tracking-tight text-ink">
                {t("supporters.giveTitle")}
              </h2>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-ink/85 marker:text-accent">
                {give.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </section>
          </div>
          <div className="mt-12">
            <AuthorSign />
          </div>
          <p className="mt-8">
            <a href={flyPath(locale)} data-track="fly_click" className="btn-primary inline-flex min-h-11 px-5">
              {t("supporters.fly")}
            </a>
          </p>
        </div>
      </main>
      <Footer locale={locale} page="supporters/" />
      <StickyCTA locale={locale} label={t("sticky.cta")} note={t("sticky.note")} />
    </>
  );
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  return <Wall locale={locale as Locale} />;
}
