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

/** A numbered list of steps (`<ol>`: a screen reader says "list, 5 items" and reads the numbers). */
function Steps({ items }: { items: string[] }) {
  return (
    <ol className="mt-3 list-decimal space-y-2 pl-6 text-ink/85">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ol>
  );
}

/**
 * The page's sections in reading order (the owner's site text note, part 4, "structure for screen readers"): one h1, then these h2 in this order;
 * the "On this page" list links to their ids. h3 appear only inside their own h2 (start: try it now; helpers: how to run a lesson).
 */
const SECTIONS = ["start", "how", "need", "keys", "now", "test", "record", "helpers", "press", "support", "open", "help"] as const;

const H2 = "text-2xl font-semibold tracking-tight text-ink";
const H3 = "mt-6 text-lg font-semibold text-ink";
const LINK = "link inline-flex min-h-11 items-center break-words";

function Sound({ locale }: { locale: Locale }) {
  const t = useTranslations();
  const raw = (k: string) => t.raw(k) as string[];
  const newTab = <span className="sr-only"> {t("sound.newTab")}</span>;
  const mail = (
    <a href={`mailto:${AUTHOR.email}`} data-track="cta_click" data-p="email" className={LINK}>
      {t("sound.help.write")}: {AUTHOR.email}
    </a>
  );
  const call = (label: string, p: string) => (
    <Ext href={AUTHOR.calendar} className={LINK} track="cta_click" p={p}>
      {label}
      {newTab}
    </Ext>
  );
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
            <nav aria-label={t("sound.toc.label")} className="mt-8">
              <p className="text-sm font-semibold text-ink">{t("sound.toc.label")}</p>
              <ul className="mt-2 gap-x-6 sm:columns-2">
                {SECTIONS.map((id) => (
                  <li key={id} className="break-inside-avoid">
                    <a href={`#sound-${id}`} className="link inline-flex min-h-11 items-center">
                      {t(`sound.${id}.title`)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-8">
          <section aria-labelledby="sound-start" className="scroll-mt-20 rounded-xl border border-line bg-surface p-6">
            <h2 id="sound-start" className={H2}>
              {t("sound.start.title")}
            </h2>
            <p className="mt-3 text-ink/85">{t("sound.start.text")}</p>
            <p className="mt-5">
              <a href={soundStartHref(locale)} data-track="fly_click" className="btn-primary inline-flex min-h-12 items-center px-5">
                {t("sound.start.button")}
              </a>
            </p>
            <p className="mt-3 text-sm text-muted">{t("sound.start.note")}</p>
            <h3 className={H3}>{t("sound.start.tryTitle")}</h3>
            <Steps items={raw("sound.start.steps")} />
          </section>

          <section aria-labelledby="sound-how" className="mt-10 scroll-mt-20">
            <h2 id="sound-how" className={H2}>
              {t("sound.how.title")}
            </h2>
            <p className="mt-3 text-ink/85">{t("sound.how.text")}</p>
            <Items items={raw("sound.how.items")} />
          </section>

          <section aria-labelledby="sound-need" className="mt-10 scroll-mt-20">
            <h2 id="sound-need" className={H2}>
              {t("sound.need.title")}
            </h2>
            <Items items={raw("sound.need.items")} />
          </section>

          <section aria-labelledby="sound-keys" className="mt-10 scroll-mt-20">
            <h2 id="sound-keys" className={H2}>
              {t("sound.keys.title")}
            </h2>
            <p className="mt-3 text-ink/85">{t("sound.keys.intro")}</p>
            <ul className="mt-3 space-y-2">
              {KEYS.map((k, i) => (
                <li key={k} className="flex items-baseline gap-3 text-ink/85">
                  <kbd className="inline-flex min-w-9 justify-center rounded-md border border-line-strong bg-surface px-2 py-0.5 font-mono text-sm text-ink">{k}</kbd>
                  <span>{raw("sound.keys.items")[i]}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted">{t("sound.keys.reader")}</p>
          </section>

          <section aria-labelledby="sound-now" className="mt-10 scroll-mt-20">
            <h2 id="sound-now" className={H2}>
              {t("sound.now.title")}
            </h2>
            <h3 className={H3}>{t("sound.now.worksTitle")}</h3>
            <Items items={raw("sound.now.works")} />
            <h3 className={H3}>{t("sound.now.notYetTitle")}</h3>
            <Items items={raw("sound.now.notYet")} />
          </section>

          <section aria-labelledby="sound-test" className="mt-10 scroll-mt-20 rounded-xl border border-line bg-surface p-6">
            <h2 id="sound-test" className={H2}>
              {t("sound.test.title")}
            </h2>
            <p className="mt-3 text-ink/85">{t("sound.test.text")}</p>
            <Items items={raw("sound.test.items")} />
            <ul className="mt-4 space-y-1">
              <li>{call(t("sound.test.call"), "calendar-sound-test")}</li>
              <li>
                <a href={`/${locale}/privacy/#fly-by-sound`} className={LINK}>
                  {t("sound.test.privacy")}
                </a>
              </li>
            </ul>
          </section>

          <section aria-labelledby="sound-record" className="mt-10 scroll-mt-20">
            <h2 id="sound-record" className={H2}>
              {t("sound.record.title")}
            </h2>
            <Items items={raw("sound.record.items")} />
            <p className="mt-4">
              <a href={`/${locale}/privacy/#fly-by-sound`} className={LINK}>
                {t("sound.record.privacy")}
              </a>
            </p>
          </section>

          <section aria-labelledby="sound-helpers" className="mt-10 scroll-mt-20">
            <h2 id="sound-helpers" className={H2}>
              {t("sound.helpers.title")}
            </h2>
            <Items items={raw("sound.helpers.items")} />
            <h3 className={H3}>{t("sound.helpers.lessonTitle")}</h3>
            <Items items={raw("sound.helpers.lesson")} />
          </section>

          <section aria-labelledby="sound-press" className="mt-10 scroll-mt-20">
            <h2 id="sound-press" className={H2}>
              {t("sound.press.title")}
            </h2>
            <p className="mt-3 text-ink/85">{t("sound.press.story")}</p>
            <p className="mt-3 text-ink/85">{t("sound.press.facts")}</p>
            <p className="mt-3 text-ink/85">{t("sound.press.contact")}</p>
            <ul className="mt-3 space-y-1">
              <li>{mail}</li>
              <li>{call(t("sound.press.call"), "calendar-sound-press")}</li>
            </ul>
          </section>

          <section aria-labelledby="sound-support" className="mt-10 scroll-mt-20">
            <h2 id="sound-support" className={H2}>
              {t("sound.support.title")}
            </h2>
            <Items items={raw("sound.support.items")} />
            <p className="mt-4 text-ink/85">
              {t("sound.support.wallIntro")}{" "}
              <a href={`/${locale}/supporters/`} className={LINK}>
                {t("sound.support.wall")}
              </a>
            </p>
          </section>

          <section aria-labelledby="sound-open" className="mt-10 scroll-mt-20">
            <h2 id="sound-open" className={H2}>
              {t("sound.open.title")}
            </h2>
            <p className="mt-3 text-ink/85">{t("sound.open.text")}</p>
            <p className="mt-3 text-ink/85">{t("sound.open.more")}</p>
            <ul className="mt-3 space-y-1">
              <li>
                <Ext href={SOUND_REPO} className={LINK} track="cta_click" p="github-sound">
                  {t("sound.open.repo")}
                  {newTab}
                </Ext>
              </li>
              <li>
                <Ext href={REPO} className={LINK} track="cta_click" p="github">
                  {t("sound.open.sim")}
                  {newTab}
                </Ext>
              </li>
            </ul>
          </section>

          <section aria-labelledby="sound-help" className="mt-12 scroll-mt-20 rounded-xl border border-line bg-surface p-6">
            <h2 id="sound-help" className="text-lg font-semibold text-ink">
              {t("sound.help.title")}
            </h2>
            <p className="mt-3 text-ink/85">{t("sound.help.text")}</p>
            <p className="mt-3">{mail}</p>
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
