import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { Each, If, Unless, rawSlot, sceneWords, slot } from "@/components/scenepage/slots";

/**
 * The template of the scene catalogue page, /{lang}/scenes/ (apps/api/scenepages.py fills it): every
 * published, not hidden scene as a card that links to its own page and straight into the simulator.
 */
export const metadata: Metadata = {
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
  other: { "gsfpv-head": "slot" },
};

function IndexPage({ locale }: { locale: Locale }) {
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
                <li aria-current="page" className="text-ink">
                  {ui.crumbScenes}
                </li>
              </ol>
            </nav>
            <p className="eyebrow mt-8">{ui.indexEyebrow}</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">{ui.indexTitle}</h1>
            <p className="mt-4 max-w-2xl text-lg text-ink/85">{slot("lede")}</p>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-8">
          <If name="cards">
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Each name="cards">
                <li className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface/50">
                  <a href={slot("href")} className="block">
                    <img src={slot("poster")} alt="" width={320} height={180} loading="lazy" decoding="async" className="aspect-video w-full bg-surface-2 object-cover" />
                  </a>
                  <div className="flex flex-1 flex-col p-5">
                    <p className="font-mono text-xs uppercase tracking-wider text-muted">
                      {slot("kindLabel")}
                      <If name="place"> · {slot("place")}</If>
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-ink">
                      <a href={slot("href")} className="link">
                        {slot("title")}
                      </a>
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      <If name="authorName">{slot("authorName")} · </If>
                      <If name="walls">
                        <span className="text-accent">{ui.wallsYes}</span>
                      </If>
                      <Unless name="walls">
                        <span className="text-warn">{ui.wallsNo}</span>
                      </Unless>
                    </p>
                    <div className="mt-auto pt-5">
                      <a href={slot("flyHref")} className="btn-primary min-h-11 px-4 text-sm">
                        {ui.indexFly}
                        <span aria-hidden="true">→</span>
                      </a>
                    </div>
                  </div>
                </li>
              </Each>
            </ul>
          </If>
          <Unless name="cards">
            <p className="text-muted">{ui.indexEmpty}</p>
          </Unless>
          <p className="mt-10 text-sm text-muted">
            {ui.updated}: {slot("updated")}
          </p>
        </div>
      </main>
      <Footer locale={locale} page={`scenes/${slot("path")}`} share={false} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: rawSlot("jsonld") }} />
    </>
  );
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  return <IndexPage locale={locale as Locale} />;
}
