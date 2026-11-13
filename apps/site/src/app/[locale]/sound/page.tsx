import type { Metadata } from "next";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { sonicLinkPath } from "@gsfpv/scenes/sonic-link";
import { AUTHOR, REPO, SOUND_REPO, flyPath } from "@/config/site";
import type { FlightSlot } from "@/config/videos";
import type { Locale } from "@/i18n/routing";
import BgVideo from "@/components/BgVideo";
import BgVideos from "@/components/BgVideos";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import JsonLd from "@/components/JsonLd";
import { Ext } from "@/components/kit";
import SoundFigure from "@/components/SoundFigure";
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
 * The page's sections in reading order: one h1, then these h2 in this order; the "On this page" list links to their ids. The first four
 * are the questions a newcomer asks (how is it possible, what do I hear, what do I need, how do I start). h3 appear only inside their
 * own h2 (start: try it now and the keys, #sound-keys; now: works and not yet; test: recording and sending, #sound-record; who: one h3
 * per audience with its own anchor, AUDIENCES, so a letter or a post can link one audience; h4 inside the teachers and support blocks).
 */
const SECTIONS = ["how", "hear", "need", "start", "now", "test", "who", "open", "help"] as const;

/** The audiences of "Who it is for and why", in order; each id is a public anchor (/{lang}/sound/#teachers is sent in letters). */
const AUDIENCES = ["blind", "pilots", "teachers", "press", "support", "developers"] as const;

/**
 * The figures of "What do I hear?" in order (components/SoundFigure): height, wall, target hum, rings and gates; each an h3 with its
 * full text. The fifth figure, the keys card, sits under the keys h3 (#sound-keys).
 */
const FIGURES = ["height", "wall", "hum", "gates"] as const;

const H4 = "mt-5 font-semibold text-ink";

const H2 = "text-2xl font-semibold tracking-tight text-ink sm:text-3xl";
const H3 = "mt-8 scroll-mt-20 text-lg font-semibold text-ink";
const LINK = "link inline-flex min-h-11 items-center break-words";
const COL = "mx-auto max-w-3xl px-4 sm:px-8";

/**
 * A section opened by a real FPV flight: a full-width strip with the loop, the h2 at its foot over a dark gradient (text over video
 * always sits on that scrim), then the text on the plain page. The video is decoration (aria-hidden, components/BgVideo); the caption
 * says what it shows. Reduced motion: the poster stays (components/BgVideos). An anchor jump to the h2 keeps the strip in view.
 */
function FlightSection({ id, slot, title, caption, children }: { id: string; slot: FlightSlot; title: string; caption: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`sound-${id}`} className="mt-14">
      <div className="relative isolate flex min-h-[clamp(15rem,42svh,28rem)] items-end overflow-hidden">
        <BgVideo slot={slot} className="-z-20" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-bg via-bg/50 to-bg/10" />
        <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-16 bg-gradient-to-b from-bg to-transparent" />
        <div className={`${COL} w-full pb-3`}>
          <h2 id={`sound-${id}`} className={`${H2} scroll-mt-[clamp(15rem,42svh,28rem)] [text-shadow:0_1px_12px_rgb(0_0_0/0.9)]`}>
            {title}
          </h2>
        </div>
      </div>
      <div className={COL}>
        <p className="text-sm text-muted">{caption}</p>
        {children}
      </div>
    </section>
  );
}

/** A section without a video. */
function Section({ id, title, boxed = false, children }: { id: string; title: string; boxed?: boolean; children: ReactNode }) {
  return (
    <div className={`${COL} mt-14`}>
      <section aria-labelledby={`sound-${id}`} className={boxed ? "rounded-xl border border-line bg-surface p-6" : ""}>
        <h2 id={`sound-${id}`} className={`${H2} scroll-mt-20`}>
          {title}
        </h2>
        {children}
      </section>
    </div>
  );
}

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
  const start = (
    <a href={soundStartHref(locale)} data-track="fly_click" className="btn-primary inline-flex min-h-12 items-center px-5">
      {t("sound.start.button")}
    </a>
  );
  return (
    <>
      <JsonLd locale={locale} description={t("sound.description")} />
      <BgVideos />
      <Header locale={locale} page="sound/" onLanding={false} />
      <main id="main" tabIndex={-1} className="pb-16 outline-none">
        {/* First screen: what this is, in one breath, and one action. The Winter Garden loop behind it (the scan of a sound lesson). */}
        <div className="relative isolate overflow-hidden border-b border-line">
          <BgVideo slot="soundHero" priority className="-z-20" />
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-bg via-bg/80 to-bg/30" />
          <div className={`${COL} flex min-h-[calc(85svh-4rem)] flex-col justify-end pb-8 pt-24`}>
            <p className="eyebrow text-sm">{t("sound.eyebrow")}</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink [text-shadow:0_1px_12px_rgb(0_0_0/0.8)] sm:text-6xl">{t("sound.h1")}</h1>
            <p className="mt-4 max-w-2xl text-lg text-ink/90 sm:text-xl">{t("sound.hero.lead")}</p>
            <p className="mt-6">{start}</p>
            <p className="mt-3 text-sm text-ink/75">{t("sound.start.note")}</p>
            <p className="mt-6 text-sm text-muted">{t("sound.media.garden")}</p>
          </div>
        </div>

        <nav aria-label={t("sound.toc.label")} className={`${COL} mt-8`}>
          <p className="text-sm font-semibold text-ink">{t("sound.toc.label")}</p>
          <ul className="mt-2 gap-x-6 sm:columns-2">
            {SECTIONS.map((id) => (
              <li key={id} className="break-inside-avoid">
                <a href={`#sound-${id}`} className="link inline-flex min-h-11 items-center">
                  {t(`sound.${id}.title`)}
                </a>
                {id === "who" ? (
                  <ul className="pl-4">
                    {AUDIENCES.map((a) => (
                      <li key={a}>
                        <a href={`#${a}`} className="link inline-flex min-h-11 items-center text-sm">
                          {t(`sound.who.${a}.title`)}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>

        <FlightSection id="how" slot="soundHow" title={t("sound.how.title")} caption={t("sound.media.pond")}>
          <p className="mt-5 text-lg text-ink/90">{t("sound.how.text")}</p>
          <p className="mt-4 text-ink/85">{t("sound.lead")}</p>
          <p className="mt-4 text-ink/85">{t("sound.now.tested")}</p>
          <p className="mt-5 rounded-md border border-warn/50 px-4 py-3 text-sm text-warn">{t("sound.status")}</p>
        </FlightSection>

        <Section id="hear" title={t("sound.hear.title")}>
          <p className="mt-3 text-ink/85">{t("sound.fig.intro")}</p>
          {FIGURES.map((f) => (
            <SoundFigure key={f} kind={f} title={t(`sound.fig.${f}.title`)} text={raw(`sound.fig.${f}.text`)} />
          ))}
          <h3 className={H3}>{t("sound.fig.moreTitle")}</h3>
          <Items items={raw("sound.how.items")} />
        </Section>

        <Section id="need" title={t("sound.need.title")}>
          <Items items={raw("sound.need.items")} />
        </Section>

        <FlightSection id="start" slot="soundStart" title={t("sound.start.title")} caption={t("sound.media.acro")}>
          <div className="mt-5 rounded-xl border border-line bg-surface p-6">
            <p className="text-ink/85">{t("sound.start.text")}</p>
            <p className="mt-5">{start}</p>
            <p className="mt-3 text-sm text-muted">{t("sound.start.note")}</p>
          </div>
          <h3 className={H3}>{t("sound.start.tryTitle")}</h3>
          <Steps items={raw("sound.start.steps")} />
          <h3 id="sound-keys" className={H3}>
            {t("sound.keys.title")}
          </h3>
          <p className="mt-3 text-ink/85">{t("sound.keys.intro")}</p>
          <SoundFigure kind="keys" text={raw("sound.fig.keys.text")} />
          <ul className="mt-3 space-y-2">
            {KEYS.map((k, i) => (
              <li key={k} className="flex items-baseline gap-3 text-ink/85">
                <kbd className="inline-flex min-w-9 justify-center rounded-md border border-line-strong bg-surface px-2 py-0.5 font-mono text-sm text-ink">{k}</kbd>
                <span>{raw("sound.keys.items")[i]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">{t("sound.keys.reader")}</p>
        </FlightSection>

        <Section id="now" title={t("sound.now.title")}>
          <h3 className={H3}>{t("sound.now.worksTitle")}</h3>
          <Items items={raw("sound.now.works")} />
          <h3 className={H3}>{t("sound.now.notYetTitle")}</h3>
          <Items items={raw("sound.now.notYet")} />
          <p className="mt-5 text-ink/85">{t("sound.now.goal")}</p>
        </Section>

        <Section id="test" title={t("sound.test.title")} boxed>
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
          <h3 id="sound-record" className={H3}>
            {t("sound.record.title")}
          </h3>
          <Items items={raw("sound.record.items")} />
          <p className="mt-4">
            <a href={`/${locale}/privacy/#fly-by-sound`} className={LINK}>
              {t("sound.record.privacy")}
            </a>
          </p>
        </Section>

        <Section id="who" title={t("sound.who.title")}>
          <p className="mt-3 text-ink/85">{t("sound.who.intro")}</p>
          {AUDIENCES.map((a) => (
            <div key={a} className="mt-8 border-l border-accent/50 pl-4">
              <h3 id={a} className="scroll-mt-20 text-lg font-semibold text-ink">
                {t(`sound.who.${a}.title`)}
              </h3>
              <p className="mt-3 text-ink/85">{t(`sound.who.${a}.text`)}</p>
              {a === "blind" ? (
                <ul className="mt-3 space-y-1">
                  <li>
                    <a href="#sound-start" className={LINK}>
                      {t("sound.who.toStart")}
                    </a>
                  </li>
                  <li>
                    <a href="#sound-test" className={LINK}>
                      {t("sound.who.toTest")}
                    </a>
                  </li>
                </ul>
              ) : null}
              {a === "pilots" ? (
                <p className="mt-3">
                  <a href="#sound-start" className={LINK}>
                    {t("sound.who.toStart")}
                  </a>
                </p>
              ) : null}
              {a === "teachers" ? (
                <>
                  <Items items={raw("sound.helpers.items")} />
                  <h4 className={H4}>{t("sound.helpers.lessonTitle")}</h4>
                  <Items items={raw("sound.helpers.lesson")} />
                  <p className="mt-3">{mail}</p>
                </>
              ) : null}
              {a === "press" ? (
                <>
                  <p className="mt-3 text-ink/85">{t("sound.press.facts")}</p>
                  <ul className="mt-3 space-y-1">
                    <li>{mail}</li>
                    <li>{call(t("sound.press.call"), "calendar-sound-press")}</li>
                  </ul>
                </>
              ) : null}
              {a === "support" ? (
                <>
                  <p className="mt-3">{mail}</p>
                  <p className="mt-3 text-ink/85">
                    {t("sound.support.wallIntro")}{" "}
                    <a href={`/${locale}/supporters/`} className={LINK}>
                      {t("sound.support.wall")}
                    </a>
                  </p>
                  <h4 className={H4}>{t("sound.who.otherTitle")}</h4>
                  <Items items={raw("sound.support.items")} />
                </>
              ) : null}
              {a === "developers" ? (
                <p className="mt-3">
                  <a href="#sound-open" className={LINK}>
                    {t("sound.who.toOpen")}
                  </a>
                </p>
              ) : null}
            </div>
          ))}
        </Section>

        <Section id="open" title={t("sound.open.title")}>
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
        </Section>

        <Section id="help" title={t("sound.help.title")} boxed>
          <p className="mt-3 text-ink/85">{t("sound.help.text")}</p>
          <p className="mt-3">{mail}</p>
        </Section>
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
