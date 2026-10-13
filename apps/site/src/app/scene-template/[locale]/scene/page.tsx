import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { ExternalMark } from "@/components/kit";
import { Each, If, Unless, rawSlot, sceneWords, slot } from "@/components/scenepage/slots";

/**
 * The template of one scene's page, /{lang}/scenes/<id>/ (apps/api/scenepages.py fills it). Words of the
 * page itself come from the scenepage dictionary; everything about the scene is a slot. The head tags
 * (title, canonical, hreflang, Open Graph) are one raw slot the API builds: the meta tag below marks
 * where it goes (scripts/scene-templates.mjs swaps it).
 */
export const metadata: Metadata = {
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
  other: { "gsfpv-head": "slot" },
};

const pill =
  "inline-flex min-h-11 items-center rounded-full border border-line-strong px-3.5 text-sm text-ink hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function ScenePage({ locale }: { locale: Locale }) {
  const ui = sceneWords(locale);
  return (
    <>
      <Header locale={locale} page={`scenes/${slot("path")}`} onLanding={false} />
      <main id="main" tabIndex={-1} className="outline-none">
        <div className="relative isolate overflow-hidden border-b border-line">
          <div aria-hidden="true" className="hero-fallback absolute inset-0 -z-10" />
          <div className="mx-auto max-w-6xl px-4 pb-10 pt-8 sm:px-8 sm:pt-12">
            <nav aria-label={ui.crumbScenes}>
              <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <li>
                  <a href={slot("homeHref")} className="link">
                    {ui.crumbHome}
                  </a>
                </li>
                <li aria-hidden="true">/</li>
                <li>
                  <a href={slot("indexHref")} className="link">
                    {ui.crumbScenes}
                  </a>
                </li>
                <li aria-hidden="true">/</li>
                <li aria-current="page" className="text-ink">
                  {slot("name")}
                </li>
              </ol>
            </nav>
            <p className="eyebrow mt-8">
              {slot("kindLabel")}
              <If name="place">
                <span className="text-muted"> · {slot("place")}</span>
              </If>
            </p>
            <h1 className="mt-3 max-w-4xl text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">{slot("h1")}</h1>
            <p className="mt-4 max-w-2xl text-lg text-ink/85">{slot("lede")}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href={slot("flyHref")} className="btn-primary min-h-14 px-7 text-lg">
                {ui.fly}
                <span aria-hidden="true">→</span>
              </a>
              <a href={slot("originUrl")} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-12 px-6">
                {ui.openOrigin}
                <ExternalMark />
              </a>
            </div>
            <p className="mt-3 max-w-xl text-sm text-muted">{ui.flyNote}</p>
          </div>
        </div>

        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div>
            <img src={slot("poster")} alt={slot("posterAlt")} width={960} height={960} decoding="async" className="aspect-[4/3] w-full rounded-xl border border-line-strong bg-surface-2 object-cover shadow-2xl shadow-black/60" />
            <p className="mt-8 text-lg leading-relaxed text-ink/90">{slot("summary")}</p>
            <If name="about">
              <section className="mt-10">
                <h2 className="text-2xl font-semibold tracking-tight text-ink">{ui.aboutTitle}</h2>
                <p className="mt-3 leading-relaxed text-ink/85">{slot("about")}</p>
              </section>
            </If>
            <If name="quote">
              <figure className="mt-10 border-l-2 border-accent pl-5">
                <figcaption className="eyebrow">{ui.quoteTitle}</figcaption>
                <blockquote className="mt-3 text-ink/85 italic">{slot("quote")}</blockquote>
                {/* "Author, from the scene's description on SuperSplat"; a scene without an author name only the source */}
                <p className="mt-2 text-sm text-muted">
                  <If name="quoteBy">
                    {slot("quoteBy")},{" "}
                    <a href={slot("originUrl")} target="_blank" rel="noopener noreferrer" className="link">
                      {ui.quoteSource}
                    </a>
                  </If>
                  <Unless name="quoteBy">
                    <a href={slot("originUrl")} target="_blank" rel="noopener noreferrer" className="link">
                      {ui.quoteSourceAlone}
                    </a>
                  </Unless>
                </p>
              </figure>
            </If>
          </div>
          <aside className="self-start">
            <section aria-labelledby="facts-title" className="rounded-xl border border-line bg-surface/50 p-5 sm:p-6">
              <h2 id="facts-title" className="text-xl font-semibold text-ink">
                {ui.factsTitle}
              </h2>
              <dl className="mt-4 divide-y divide-line border-y border-line">
                <Each name="facts">
                  <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-sm text-muted">{slot("k")}</dt>
                    <dd className="text-[15px] text-ink">{slot("v")}</dd>
                  </div>
                </Each>
              </dl>
            </section>
            <If name="tags">
              <section className="mt-8">
                <h2 className="text-base font-semibold text-ink">{ui.tagsTitle}</h2>
                <ul className="mt-3 flex flex-wrap gap-2 font-mono text-[13px] text-muted">
                  <Each name="tags">
                    <li className="rounded-full border border-line px-3 py-1">{slot("tag")}</li>
                  </Each>
                </ul>
              </section>
            </If>
            <section className="mt-8">
              <h2 className="text-base font-semibold text-ink">{ui.shareTitle}</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <Each name="share">
                  <a className={pill} href={slot("href")} data-share={slot("id")} target="_blank" rel="noopener noreferrer">
                    {slot("label")}
                  </a>
                </Each>
              </div>
            </section>
          </aside>
        </div>

        <section aria-labelledby="faq-title" className="border-t border-line bg-surface/50">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-8 sm:py-16">
            <h2 id="faq-title" className="text-3xl font-semibold tracking-tight text-ink">
              {ui.faqTitle}
            </h2>
            <div className="mt-8 divide-y divide-line rounded-xl border border-line bg-bg">
              <Each name="faq">
                <details className="group px-5 sm:px-6">
                  <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-4 py-4 text-base font-semibold text-ink sm:text-lg">
                    <h3 className="font-semibold">{slot("q")}</h3>
                    <span aria-hidden="true" className="font-mono text-xl text-accent transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="max-w-3xl pb-5 text-muted">{slot("a")}</p>
                </details>
              </Each>
            </div>
          </div>
        </section>

        <section aria-labelledby="more-title" className="border-t border-line">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-8 sm:py-16">
            <p className="text-sm text-muted">
              {ui.creditScan}{" "}
              <a href={slot("originUrl")} target="_blank" rel="noopener noreferrer" className="link">
                {slot("name")}
              </a>{" "}
              {/* "by <author>" only when SuperSplat names one (a scene without an author reads "Scan X · licence") */}
              <If name="authorName">
                · {ui.creditBy}{" "}
                <If name="authorUrl">
                  <a href={slot("authorUrl")} target="_blank" rel="noopener noreferrer" className="link">
                    {slot("authorName")}
                  </a>
                </If>
                <Unless name="authorUrl">{slot("authorName")}</Unless>{" "}
              </If>
              ·{" "}
              {/* "licence CC BY 4.0" when SuperSplat names a known licence; otherwise the slot alone, which is
                  either the licence text or the "no licence stated" phrase (never "licence no licence stated"). */}
              <If name="licenseUrl">
                {ui.creditLicence}{" "}
                <a href={slot("licenseUrl")} target="_blank" rel="noopener noreferrer license" className="link">
                  {slot("license")}
                </a>
              </If>
              <Unless name="licenseUrl">{slot("license")}</Unless>
            </p>
            <p className="mt-1 max-w-3xl text-sm text-muted">{ui.creditNote}</p>
            <If name="more">
              <h2 id="more-title" className="mt-12 text-2xl font-semibold tracking-tight text-ink">
                {ui.moreTitle}
              </h2>
              <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <Each name="more">
                  <li className="overflow-hidden rounded-xl border border-line bg-surface/50">
                    <a href={slot("href")} className="block">
                      <img src={slot("poster")} alt="" width={320} height={180} loading="lazy" decoding="async" className="aspect-video w-full bg-surface-2 object-cover" />
                      <span className="block px-4 pt-4 font-semibold text-ink">{slot("title")}</span>
                      <span className="block px-4 pb-4 pt-1 text-sm text-muted">
                        {slot("meta")} ·{" "}
                        <If name="walls">{ui.wallsYes}</If>
                        <Unless name="walls">{ui.wallsNo}</Unless>
                      </span>
                    </a>
                  </li>
                </Each>
              </ul>
            </If>
            <p className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
              <a href={slot("indexHref")} className="link inline-flex min-h-11 items-center">
                {ui.allPlaces}
              </a>
              <span>
                {ui.updated}: {slot("updated")}
              </span>
            </p>
          </div>
        </section>
      </main>
      <Footer locale={locale} page={`scenes/${slot("path")}`} share={false} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: rawSlot("jsonld") }} />
    </>
  );
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  return <ScenePage locale={locale as Locale} />;
}
