import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AUTHOR, flyPath, posterUrl } from "@/config/site";
import type { Locale } from "@/i18n/routing";
import AuthorSign from "@/components/AuthorSign";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import JsonLd from "@/components/JsonLd";
import StickyCTA from "@/components/StickyCTA";
import SupporterCard from "@/components/SupporterCard";
import { Ext } from "@/components/kit";
import { findSupporter, SUPPORTERS, type Supporter } from "@/lib/supporters";
import { pageMetadata } from "@/lib/meta";

export const dynamicParams = false;

export function generateStaticParams() {
  return SUPPORTERS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const p = findSupporter(slug);
  if (!p) return {};
  const t = await getTranslations({ locale, namespace: "supporters.person" });
  const title = p.status === "joined" ? t("metaJoined", { name: p.name }) : t("metaDraft", { name: p.name });
  const meta = pageMetadata({ locale: locale as Locale, page: `supporters/${slug}/`, title, description: t("metaDescription", { name: p.name, role: p.text[locale as Locale].role }) });
  // a draft made before the first message: reachable by its link only, never indexed
  return p.status === "joined" ? meta : { ...meta, robots: { index: false, follow: false } };
}

const month = (locale: Locale, iso: string) => new Intl.DateTimeFormat(locale, { year: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00Z`));

function Person({ locale, p }: { locale: Locale; p: Supporter }) {
  const t = useTranslations();
  const text = p.text[locale];
  const draft = p.status === "invited";
  const page = `supporters/${p.slug}/`;
  const fly = p.scene ? `${flyPath(locale)}?scene=${p.scene}` : flyPath(locale);
  const h2 = "text-2xl font-semibold tracking-tight text-ink";
  return (
    <>
      <JsonLd locale={locale} description={t("meta.description")} />
      <Header locale={locale} page={page} onLanding={false} />
      <main id="main" tabIndex={-1} className="outline-none">
        {draft ? (
          <div role="note" className="border-b border-warn/40 bg-warn/10" data-testid="supporter-draft">
            <div className="mx-auto max-w-4xl px-4 py-4 sm:px-8">
              <p className="font-semibold text-ink">{t("supporters.person.draftTitle", { name: p.name })}</p>
              <p className="mt-1 text-sm text-ink/85">
                {t("supporters.person.draftBody")}{" "}
                <a href={`mailto:${AUTHOR.email}`} className="link" data-track="cta_click" data-p="email">
                  {AUTHOR.email}
                </a>
              </p>
            </div>
          </div>
        ) : null}
        <div className="relative isolate overflow-hidden border-b border-line">
          <div aria-hidden="true" className="hero-fallback absolute inset-0 -z-10" />
          <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pb-10 pt-12 sm:flex-row sm:items-center sm:px-8 sm:pt-16">
            <img src={p.photo} alt={p.name} width={128} height={128} decoding="async" className="size-32 shrink-0 rounded-full border border-line-strong object-cover" />
            <div className="min-w-0">
              <p className="eyebrow">{t("supporters.eyebrow")}</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{p.name}</h1>
              <p className="mt-2 text-lg text-muted">{text.role}</p>
              <ul className="mt-2 flex flex-wrap gap-x-5 text-sm">
                {p.links.map((l) => (
                  <li key={l.href}>
                    <Ext href={l.href} className="link inline-flex min-h-11 items-center">
                      {l.label}
                    </Ext>
                  </li>
                ))}
              </ul>
              {draft ? <p className="text-xs text-muted">{t(p.photoInitials ? "supporters.person.photoInitials" : "supporters.person.photoNote")}</p> : null}
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-4xl space-y-12 px-4 py-12 sm:px-8">
          <section aria-labelledby="about-title">
            <h2 id="about-title" className={h2}>
              {t("supporters.person.aboutTitle", { name: p.name })}
            </h2>
            <p className="mt-3 text-ink/85">{text.about}</p>
            {p.works.length ? (
              <>
                <h3 className="mt-6 text-lg font-semibold text-ink">{t("supporters.person.worksTitle", { name: p.name })}</h3>
                <ul className="mt-2 space-y-1">
                  {p.works.map((w) => (
                    <li key={w.href} className="text-ink/85">
                      <Ext href={w.href} className="link">
                        {w.title}
                      </Ext>{" "}
                      <span className="text-sm text-muted">· {month(locale, w.date)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
          <section aria-labelledby="review-title">
            <h2 id="review-title" className={h2}>
              {t("supporters.person.reviewTitle", { name: p.name })}
            </h2>
            {p.review ? (
              <div className="mt-4 overflow-hidden rounded-xl border border-line" data-testid="supporter-review">
                {p.review.thumb ? (
                  <a href={p.review.href} target="_blank" rel="noopener noreferrer" className="block">
                    <img src={p.review.thumb} alt={p.review.title} width={1280} height={720} loading="lazy" decoding="async" className="aspect-video w-full object-cover" />
                  </a>
                ) : null}
                <p className="p-5">
                  <Ext href={p.review.href} className="link text-lg font-semibold">
                    {p.review.title}
                  </Ext>
                  <span className="mt-1 block text-sm text-muted">
                    {t(p.review.kind === "video" ? "supporters.person.watch" : "supporters.person.read", { platform: p.review.platform })} · {month(locale, p.review.date)}
                  </span>
                </p>
              </div>
            ) : (
              <div className="mt-4 flex aspect-video flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line-strong bg-surface/40 p-6 text-center" data-testid="supporter-review-empty">
                <svg aria-hidden="true" viewBox="0 0 48 48" className="size-14 text-accent">
                  <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeWidth="2" />
                  <path d="M19 15 L35 24 L19 33 Z" fill="currentColor" />
                </svg>
                <p className="text-xl font-semibold text-ink">{t("supporters.person.reviewEmptyTitle")}</p>
                <p className="max-w-xl text-sm text-ink/85">{t("supporters.person.reviewEmptyBody")}</p>
              </div>
            )}
          </section>
          <section aria-labelledby="why-title">
            <h2 id="why-title" className={h2}>
              {t("supporters.person.whyTitle")}
            </h2>
            <p className="mt-3 text-ink/85">{text.why}</p>
          </section>
          <section aria-labelledby="offer-title">
            <h2 id="offer-title" className={h2}>
              {t("supporters.person.offerTitle")}
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-ink/85 marker:text-accent">
              {text.offer.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="card-title">
            <h2 id="card-title" className={h2}>
              {t("supporters.person.cardTitle")}
            </h2>
            <p className="mt-3 text-ink/85">{t("supporters.person.cardBody")}</p>
            <div className="mt-4 max-w-sm" data-testid="supporter-card-preview">
              <SupporterCard p={p} locale={locale} linked={false} />
            </div>
            <p className="mt-3">
              <a href={`/${locale}/supporters/`} className="link inline-flex min-h-11 items-center">
                {t("supporters.person.wall")}
              </a>
            </p>
          </section>
          <section aria-labelledby="fly-title">
            <h2 id="fly-title" className={h2}>
              {t("supporters.person.flyTitle")}
            </h2>
            <p className="mt-3 text-ink/85">{t("supporters.person.flyBody")}</p>
            {p.scene ? (
              <figure className="mt-4">
                <a href={fly} data-track="fly_click" className="block overflow-hidden rounded-xl border border-line">
                  <img src={posterUrl(p.scene, "l", p.sceneVersion)} alt={p.sceneCredit ?? ""} width={1280} height={720} loading="lazy" decoding="async" className="aspect-video w-full object-cover" />
                </a>
                {p.sceneCredit ? <figcaption className="mt-2 text-sm text-muted">{p.sceneCredit}</figcaption> : null}
              </figure>
            ) : null}
            <p className="mt-4">
              <a href={fly} data-track="fly_click" className="btn-primary inline-flex min-h-11 px-5">
                {p.scene ? t("supporters.person.flyScene") : t("supporters.person.fly")}
              </a>
            </p>
          </section>
          <AuthorSign />
        </div>
      </main>
      <Footer locale={locale} page={page} />
      <StickyCTA locale={locale} label={t("sticky.cta")} note={t("sticky.note")} />
    </>
  );
}

export default async function Page({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);
  const p = findSupporter(slug);
  if (!p) notFound();
  return <Person locale={locale as Locale} p={p} />;
}
