import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { sonicLinkPath } from "@gsfpv/scenes/sonic-link";
import { AUTHOR, REPO, SOUND_REPO, flyPath } from "@/config/site";
import type { Locale } from "@/i18n/routing";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import JsonLd from "@/components/JsonLd";
import { Ext } from "@/components/kit";
import { pageMetadata } from "@/lib/meta";

/**
 * The keys of the sound mode in the order the dictionary's `sound.keys.items` describe them (the letters are the same in every language).
 * T U I Z G exist only in the mode (the simulator's keymap, `when: 'sonic'`); L and K do the mode's own thing there (copy a link to the
 * lesson, say the keys).
 */
const KEYS = ["T", "U", "I", "Z", "G", "R", "N", "L", "K"] as const;

/**
 * The start link: the same kind of link a pilot's L copies in a lesson (@gsfpv/scenes sonic-link.ts), here for the start screen and in
 * the page's own language, with the mode's default sound.
 */
const soundStartHref = (locale: string): string => sonicLinkPath({ lesson: "start", sound: {} }, flyPath(locale));

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "sound" });
  return pageMetadata({ locale: locale as Locale, page: "sound/", title: t("title"), description: t("description") });
}

/** A bulleted list of plain sentences; real list markup, so a screen reader announces "list, 4 items". */
function Items({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 list-disc space-y-2 pl-5 text-ink/85">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}

function Sound({ locale }: { locale: Locale }) {
  const t = useTranslations();
  const need = t.raw("sound.need.items") as string[];
  const keys = t.raw("sound.keys.items") as string[];
  const record = t.raw("sound.record.items") as string[];
  const helpers = t.raw("sound.helpers.items") as string[];
  return (
    <>
      <JsonLd locale={locale} description={t("sound.description")} />
      <Header locale={locale} page="sound/" onLanding={false} />
      <main id="main" tabIndex={-1} className="outline-none">
        <div className="relative isolate overflow-hidden border-b border-line">
          <div aria-hidden="true" className="hero-fallback absolute inset-0 -z-10" />
          <div className="mx-auto max-w-3xl px-4 pb-10 pt-16 sm:px-8 sm:pt-24">
            <p className="eyebrow">{t("sound.eyebrow")}</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{t("sound.h1")}</h1>
            <p className="mt-4 max-w-2xl text-lg text-muted">{t("sound.lead")}</p>
            <p className="mt-4 inline-flex rounded-md border border-warn/50 px-3 py-1.5 text-sm text-warn">{t("sound.status")}</p>
          </div>
        </div>
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-8">
          <section aria-labelledby="sound-start" className="rounded-xl border border-line bg-surface p-6">
            <h2 id="sound-start" className="text-2xl font-semibold tracking-tight text-ink">
              {t("sound.start.title")}
            </h2>
            <p className="mt-3 text-ink/85">{t("sound.start.text")}</p>
            <p className="mt-5">
              <a href={soundStartHref(locale)} data-track="fly_click" className="btn-primary inline-flex min-h-12 items-center px-5">
                {t("sound.start.button")}
              </a>
            </p>
            <p className="mt-3 text-sm text-muted">{t("sound.start.note")}</p>
          </section>

          <section aria-labelledby="sound-need" className="mt-10">
            <h2 id="sound-need" className="text-2xl font-semibold tracking-tight text-ink">
              {t("sound.need.title")}
            </h2>
            <Items items={need} />
          </section>

          <section aria-labelledby="sound-keys" className="mt-10">
            <h2 id="sound-keys" className="text-2xl font-semibold tracking-tight text-ink">
              {t("sound.keys.title")}
            </h2>
            <p className="mt-3 text-ink/85">{t("sound.keys.intro")}</p>
            <ul className="mt-3 space-y-2">
              {KEYS.map((k, i) => (
                <li key={k} className="flex items-baseline gap-3 text-ink/85">
                  <kbd className="inline-flex min-w-9 justify-center rounded-md border border-line-strong bg-surface px-2 py-0.5 font-mono text-sm text-ink">{k}</kbd>
                  <span>{keys[i]}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="sound-record" className="mt-10">
            <h2 id="sound-record" className="text-2xl font-semibold tracking-tight text-ink">
              {t("sound.record.title")}
            </h2>
            <Items items={record} />
            <p className="mt-4">
              <a href={`/${locale}/privacy/#fly-by-sound`} className="link inline-flex min-h-11 items-center">
                {t("sound.record.privacy")}
              </a>
            </p>
          </section>

          <section aria-labelledby="sound-helpers" className="mt-10">
            <h2 id="sound-helpers" className="text-2xl font-semibold tracking-tight text-ink">
              {t("sound.helpers.title")}
            </h2>
            <Items items={helpers} />
          </section>

          <section aria-labelledby="sound-open" className="mt-10">
            <h2 id="sound-open" className="text-2xl font-semibold tracking-tight text-ink">
              {t("sound.open.title")}
            </h2>
            <p className="mt-3 text-ink/85">{t("sound.open.text")}</p>
            <ul className="mt-3 space-y-1">
              <li>
                <Ext href={SOUND_REPO} className="link inline-flex min-h-11 items-center" track="cta_click" p="github-sound">
                  {t("sound.open.repo")}
                </Ext>
              </li>
              <li>
                <Ext href={REPO} className="link inline-flex min-h-11 items-center" track="cta_click" p="github">
                  {t("sound.open.sim")}
                </Ext>
              </li>
            </ul>
          </section>

          <section aria-labelledby="sound-help" className="mt-12 rounded-xl border border-line bg-surface p-6">
            <h2 id="sound-help" className="text-lg font-semibold text-ink">
              {t("sound.help.title")}
            </h2>
            <p className="mt-3 text-ink/85">{t("sound.help.text")}</p>
            <p className="mt-3">
              <a href={`mailto:${AUTHOR.email}`} data-track="cta_click" data-p="email" className="link inline-flex min-h-11 items-center">
                {t("sound.help.write")}: {AUTHOR.email}
              </a>
            </p>
          </section>
        </div>
      </main>
      <Footer locale={locale} page="sound/" />
    </>
  );
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  return <Sound locale={locale as Locale} />;
}
