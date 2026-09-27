import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AGENT_PROMPT, AUTHOR, GOOD_FIRST_ISSUES, REPO, REPO_BLOB, SHOWCASE, flyPath, posterUrl, superSplatUrl } from "@/config/site";
import type { Locale } from "@/i18n/routing";
import { Ext, Section } from "@/components/kit";
import CopyBlock from "@/components/CopyBlock";
import DeferImages from "@/components/DeferImages";
import Footer from "@/components/Footer";
import Gallery from "@/components/Gallery";
import type { GalleryItem } from "@/components/Gallery";
import Header from "@/components/Header";
import HeroMedia from "@/components/HeroMedia";
import JsonLd from "@/components/JsonLd";
import LeadForm from "@/components/LeadForm";
import LiveNumbers from "@/components/LiveNumbers";
import Parallax from "@/components/Parallax";
import ScenePaste from "@/components/ScenePaste";
import SettingsCatalog from "@/components/SettingsCatalog";
import ShotBackdrop from "@/components/ShotBackdrop";
import ShotBand from "@/components/ShotBand";
import StickyCTA from "@/components/StickyCTA";
import Tour from "@/components/Tour";
import { pageMetadata } from "@/lib/meta";
import { SHOTS, absolute, full, panel, shot, shotDate } from "@/lib/shots";
import type { ShotCaption } from "@/lib/shots";

type TD = { t: string; d: string };
type QA = { q: string; a: string };
type CraftRow = { k: string; v: string; src: "manufacturer" | "measured" | "claim" | "estimate" };
type RadioRow = { browser: string; input: string; status: string; level: "sim" | "emu" | "none" | "view" };
type CompareRow = { k: string; cells: string[] };
type Thanks = { name: string; license: string; d: string; href: string };
type FeatureGroup = { t: string; items: string[] };
type FeatureStatus = "live" | "progress" | "next";

/** Screenshots named in the structured data (the rest are on the page). */
const LD_SHOTS = ["flight-tunis", "voxels", "wizard-throttle", "pause", "drones", "settings", "crash", "cinema", "voxels-only", "walls", "betaflight", "keys", "m-touch", "picker"];

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return pageMetadata({ locale: locale as Locale, page: "", title: t("title"), description: t("description") });
}

const SRC_STYLE: Record<CraftRow["src"], string> = {
  manufacturer: "border-line-strong text-muted",
  measured: "border-accent/50 text-accent",
  claim: "border-warn/50 text-warn",
  estimate: "border-line-strong text-muted",
};

const LEVEL_STYLE: Record<RadioRow["level"], string> = {
  emu: "border-accent/50 text-accent",
  sim: "border-warn/50 text-warn",
  none: "border-warn/50 text-warn",
  view: "border-line-strong text-muted",
};

/** Feature board: one colour per status, the same pairs as the source chips above. */
const STATUS_STYLE: Record<FeatureStatus, { chip: string; tile: string; num: string; bar: string }> = {
  live: { chip: "border-accent/50 text-accent", tile: "border-accent/40", num: "text-accent", bar: "bg-accent" },
  progress: { chip: "border-warn/50 text-warn", tile: "border-warn/40", num: "text-warn", bar: "bg-warn" },
  next: { chip: "border-line-strong text-muted", tile: "border-line-strong", num: "text-ink", bar: "bg-line-strong" },
};

function StatusChip({ status, label }: { status: FeatureStatus; label: string }) {
  return <span className={`mt-px inline-flex shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs leading-5 ${STATUS_STYLE[status].chip}`}>{label}</span>;
}

/** Typography only: a range such as "8–30 ms" never breaks after its dash, a dash never starts a line. */
const keepTogether = (s: string) => s.replace(/(\d)–(?=\d)/g, "$1–\u2060").replace(/ — /g, "\u00a0— ");

function FeatureRows({ items, status, label }: { items: string[]; status: FeatureStatus; label: string }) {
  return (
    <ul className="mt-3 divide-y divide-line">
      {items.map((it) => (
        <li key={it} className="flex items-start justify-between gap-3 py-2.5">
          <span className="text-[15px] leading-snug text-ink/90">{keepTogether(it)}</span>
          <StatusChip status={status} label={label} />
        </li>
      ))}
    </ul>
  );
}

function Landing({ locale }: { locale: Locale }) {
  const t = useTranslations();
  const how = t.raw("how.steps") as TD[];
  const real = t.raw("real.items") as TD[];
  const craft = t.raw("real.craft.rows") as CraftRow[];
  const radios = t.raw("radios.rows") as RadioRow[];
  const compareCols = t.raw("compare.cols") as string[];
  const compareRows = t.raw("compare.rows") as CompareRow[];
  const risks = t.raw("risks.items") as TD[];
  const faq = t.raw("faq.items") as QA[];
  const thanks = t.raw("opensource.thanks") as Thanks[];
  const heroFacts = t.raw("hero.facts") as string[];
  const featGroups = t.raw("features.groups") as FeatureGroup[];
  const featProgress = t.raw("features.progress") as string[];
  const featNext = t.raw("features.next") as string[];
  const featCounts: [FeatureStatus, number][] = [
    ["live", featGroups.reduce((n, g) => n + g.items.length, 0)],
    ["progress", featProgress.length],
    ["next", featNext.length],
  ];
  const fly = flyPath(locale);
  const caps = t.raw("shots.items") as Record<string, ShotCaption>;
  const shots = SHOTS.filter((s) => caps[s.id]);
  // the grid shows each menu as its crop (readable small), the lightbox the whole screen
  const gallery: GalleryItem[] = shots.map((s) => {
    const th = panel(s);
    return { id: s.id, t: caps[s.id].t, d: caps[s.id].d, open: t("shots.gallery.open", { title: caps[s.id].t }), phone: s.device === "mobile", thumb: { small: th.small, large: th.large }, full: s.large };
  });
  const ldShots = LD_SHOTS.filter((id) => caps[id]).map((id) => {
    const s = full(shot(id));
    return { url: absolute(s), caption: `${caps[id].t}: ${caps[id].d}`, width: s.large.w, height: s.large.h };
  });

  return (
    <>
      <JsonLd locale={locale} description={t("meta.description")} faq={faq} features={featGroups.flatMap((g) => g.items)} screenshots={ldShots} />
      <Parallax />
      <DeferImages />
      <Header locale={locale} page="" onLanding />

      <main id="main" tabIndex={-1} className="outline-none">
        {/* 1. Hero */}
        <section id="top" aria-labelledby="top-title" className="relative isolate overflow-hidden">
          <HeroMedia />
          <div aria-hidden="true" className="absolute inset-0 bg-bg/75 md:bg-transparent md:bg-gradient-to-r md:from-bg/95 md:via-bg/75 md:to-bg/35" />
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-bg" />
          <div className="relative mx-auto flex min-h-[calc(100svh-4rem)] max-w-6xl flex-col justify-center px-4 py-16 sm:px-8 sm:py-24">
            <p className="eyebrow">{t("hero.eyebrow")}</p>
            <h1 id="top-title" className="mt-4 max-w-4xl text-[2.35rem] font-semibold leading-[1.05] tracking-tight text-ink sm:text-6xl lg:text-7xl">
              {t("hero.h1")}
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-ink/85 sm:text-xl">{t("hero.sub")}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href={fly} data-track="fly_click" className="btn-primary min-h-14 px-7 text-lg">
                {t("hero.cta")}
                <span aria-hidden="true">→</span>
              </a>
              <p className="text-sm text-muted sm:ml-2 sm:max-w-xs">{t("hero.ctaNote")}</p>
            </div>
            <div className="mt-10">
              <ScenePaste locale={locale} label={t("hero.paste.label")} placeholder={t("hero.paste.placeholder")} button={t("hero.paste.button")} hint={t("hero.paste.hint")} empty={t("hero.paste.empty")} />
            </div>
            <ul className="mt-12 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[13px] text-muted">
              {heroFacts.map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 1b. Real screenshots sliding with the scroll (decorative; the tour and gallery caption them) */}
        <ShotBand label={t("shots.band", { n: shots.length })} />

        {/* 1c. Tour: each feature group next to the screens that show it */}
        <Section id="tour" index="01" eyebrow={t("shots.tour.eyebrow")} title={t("shots.tour.h2")} lead={t("shots.tour.lead", { n: shots.length, date: shotDate(locale) })}>
          <Tour />
        </Section>

        {/* 1d. What you can set up: live / in progress / next */}
        <Section id="features" index="02" eyebrow={t("features.eyebrow")} title={keepTogether(t("features.h2"))} lead={t("features.lead")} tone="surface">
          <div className="mt-10 max-w-2xl">
            <dl className="grid grid-cols-3 gap-3">
              {featCounts.map(([k, n]) => (
                <div key={k} className={`flex flex-col-reverse justify-end gap-1 rounded-xl border bg-bg p-4 ${STATUS_STYLE[k].tile}`}>
                  <dt className="text-sm leading-snug text-muted">{t(`features.count.${k}`)}</dt>
                  <dd className={`font-mono text-3xl font-semibold leading-none sm:text-4xl ${STATUS_STYLE[k].num}`}>{n}</dd>
                </div>
              ))}
            </dl>
            <div aria-hidden="true" className="mt-3 flex h-1.5 gap-1 overflow-hidden rounded-full">
              {featCounts.map(([k, n]) => (
                <span key={k} className={`rounded-full ${STATUS_STYLE[k].bar}`} style={{ flexGrow: n }} />
              ))}
            </div>
          </div>

          <h3 className="mt-14 text-2xl font-semibold text-ink">{t("features.nowTitle")}</h3>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            {t.rich("features.nowNote", {
              link: (chunks) => (
                <a href="#radios" className="link">
                  {chunks}
                </a>
              ),
            })}
          </p>
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featGroups.map((g) => (
              <li key={g.t} className="rounded-xl border border-line bg-bg p-5">
                <h4 className="flex items-baseline justify-between gap-3 text-lg font-semibold text-ink">
                  {g.t}
                  <span aria-hidden="true" className="font-mono text-sm font-normal text-muted">
                    {g.items.length}
                  </span>
                </h4>
                <FeatureRows items={g.items} status="live" label={t("features.status.live")} />
              </li>
            ))}
          </ul>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <article aria-labelledby="features-progress" className="rounded-xl border border-warn/30 bg-bg p-5 sm:p-6">
              <h3 id="features-progress" className="flex items-center gap-3 text-2xl font-semibold text-ink">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-warn" />
                {t("features.progressTitle")}
              </h3>
              <p className="mt-2 text-sm text-muted">{t("features.progressNote")}</p>
              <FeatureRows items={featProgress} status="progress" label={t("features.status.progress")} />
            </article>
            <article aria-labelledby="features-next" className="rounded-xl border border-line bg-bg p-5 sm:p-6">
              <h3 id="features-next" className="flex items-center gap-3 text-2xl font-semibold text-ink">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-line-strong" />
                {t("features.nextTitle")}
              </h3>
              <p className="mt-2 text-sm text-muted">{t("features.nextNote")}</p>
              <FeatureRows items={featNext} status="next" label={t("features.status.next")} />
            </article>
          </div>

          <div className="mt-8 flex flex-col gap-4 rounded-xl border border-accent/30 bg-bg p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <p className="text-lg font-semibold text-ink">{t("features.suggest")}</p>
            <a href="#contact" className="btn-secondary min-h-12 shrink-0 px-6">
              {t("features.suggestLink")}
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </Section>

        {/* 1e. Every screen, one by one */}
        <Section id="gallery" index="03" eyebrow={t("shots.gallery.eyebrow")} title={t("shots.gallery.h2")} lead={t("shots.gallery.lead")}>
          <Gallery items={gallery} labels={{ label: t("shots.gallery.label"), prev: t("shots.gallery.prev"), next: t("shots.gallery.next"), close: t("shots.gallery.close"), count: t.raw("shots.gallery.count") as string, phone: t("shots.gallery.phone") }} />
        </Section>

        {/* 2. How it works */}
        <Section id="how" index="04" eyebrow={t("how.eyebrow")} title={t("how.h2")} lead={t("how.lead")} backdrop={<ShotBackdrop id="flight-garden" />}>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {how.map((s, i) => (
              <li key={s.t} className="rounded-xl border border-line bg-surface p-6">
                <p className="font-mono text-sm text-accent">0{i + 1}</p>
                <h3 className="mt-3 text-xl font-semibold text-ink">{s.t}</h3>
                <p className="mt-2 text-muted">{s.d}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* 3. Why it feels real */}
        <Section id="real" index="05" eyebrow={t("real.eyebrow")} title={t("real.h2")} lead={t("real.lead")} tone="surface" backdrop={<ShotBackdrop id="voxels-only" tone="voxel" drift={-70} />}>
          <div className="mt-10 grid gap-8 lg:grid-cols-[1.25fr_1fr]">
            <ul className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
              {real.map((it) => (
                <li key={it.t} className="border-l border-accent/40 pl-4">
                  <h3 className="text-lg font-semibold text-ink">{it.t}</h3>
                  <p className="mt-1.5 text-muted">{it.d}</p>
                </li>
              ))}
            </ul>
            <article aria-labelledby="craft-title" className="self-start rounded-xl border border-line bg-bg p-5 sm:p-6">
              <p className="eyebrow text-muted">{t("real.craft.eyebrow")}</p>
              <h3 id="craft-title" className="mt-2 text-xl font-semibold text-ink">
                {t("real.craft.title")}
              </h3>
              <p className="mt-1 text-sm text-muted">{t("real.craft.sub")}</p>
              <dl className="mt-5 divide-y divide-line border-y border-line">
                {craft.map((r) => (
                  <div key={r.k} className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
                    <dt className="text-sm text-muted sm:pt-0.5">{r.k}</dt>
                    <dd className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="font-mono text-[15px] text-ink">{r.v}</span>
                      <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${SRC_STYLE[r.src]}`}>{t(`real.craft.src.${r.src}`)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs text-muted">{t("real.craft.note")}</p>
            </article>
          </div>
        </Section>

        {/* 3b. Every setting, key and drone: generated from the settings schema (scripts/gen-catalog.ts) */}
        <Section id="tune" index="06" eyebrow={t("tune.eyebrow")} title={keepTogether(t("tune.h2"))} lead={t("tune.lead")}>
          <SettingsCatalog locale={locale} />
        </Section>

        {/* 4. Live numbers */}
        <Section id="numbers" index="07" eyebrow={t("numbers.eyebrow")} title={t("numbers.h2")} lead={t("numbers.lead")} backdrop={<ShotBackdrop id="flight-villa" />}>
          <LiveNumbers />
        </Section>

        {/* 5. Andrii's scans */}
        <Section id="scenes" index="08" eyebrow={t("scenes.eyebrow")} title={t("scenes.h2")} lead={t("scenes.lead")} tone="surface">
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {SHOWCASE.map((s) => {
              const title = t(`scenes.items.${s.id}`);
              return (
                <li key={s.id} className="flex flex-col overflow-hidden rounded-xl border border-line bg-bg">
                  <img
                    src={posterUrl(s.id, "m")}
                    srcSet={`${posterUrl(s.id, "m")} 240w, ${posterUrl(s.id, "l")} 480w, ${posterUrl(s.id, "xl")} 960w`}
                    sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
                    width={240}
                    height={240}
                    alt={t("scenes.alt", { title })}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[4/3] w-full bg-surface-2 object-cover"
                  />
                  <div className="flex flex-1 flex-col p-5">
                    <p className="font-mono text-xs uppercase tracking-wider text-muted">
                      {t(`scenes.kind.${s.kind}`)} · <span className="normal-case">{s.id}</span>
                    </p>
                    <h3 className="mt-2 text-lg font-semibold text-ink">{title}</h3>
                    <p className="mt-1 text-sm text-muted">
                      {t("scenes.author", { name: AUTHOR.name })} · CC BY 4.0
                    </p>
                    <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5">
                      <a href={`${fly}?scene=${s.id}`} data-track="scene_open" data-p="showcase" className="btn-primary min-h-11 px-4 text-sm">
                        {t("scenes.fly")}
                        <span className="sr-only">: {title}</span>
                      </a>
                      <Ext href={superSplatUrl(s.id)} className="link inline-flex min-h-11 items-center text-sm">
                        {t("scenes.original")}
                        <span className="sr-only">: {title}</span>
                      </Ext>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>

        {/* 6. Works with your radio */}
        <Section id="radios" index="09" eyebrow={t("radios.eyebrow")} title={t("radios.h2")} lead={t("radios.lead")}>
          <div className="mt-10 overflow-hidden rounded-xl border border-line">
            <div aria-hidden="true" className="hidden grid-cols-[1fr_1.6fr_1.6fr] gap-6 border-b border-line bg-surface px-6 py-3 font-mono text-xs uppercase tracking-wider text-muted md:grid">
              <span>{t("radios.cols.browser")}</span>
              <span>{t("radios.cols.input")}</span>
              <span>{t("radios.cols.status")}</span>
            </div>
            <ul className="divide-y divide-line">
              {radios.map((r, i) => (
                <li key={i} className="grid gap-2 px-5 py-4 md:grid-cols-[1fr_1.6fr_1.6fr] md:gap-6 md:px-6">
                  <p className="text-sm text-muted md:text-base md:text-ink">
                    <span className="sr-only">{t("radios.cols.browser")}: </span>
                    {r.browser}
                  </p>
                  <p className="text-ink">
                    <span className="sr-only">{t("radios.cols.input")}: </span>
                    {r.input}
                  </p>
                  <p className="text-sm">
                    <span className="sr-only">{t("radios.cols.status")}: </span>
                    <span className={`inline-flex rounded-md border px-2.5 py-1 leading-snug ${LEVEL_STYLE[r.level]}`}>{r.status}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-4 max-w-3xl text-sm text-muted">{t("radios.note")}</p>
        </Section>

        {/* 7. Why this is better */}
        <Section id="compare" index="10" eyebrow={t("compare.eyebrow")} title={t("compare.h2")} lead={t("compare.lead")} tone="surface">
          <p aria-hidden="true" className="mt-8 font-mono text-xs text-muted md:hidden">
            {t("compare.swipe")} →
          </p>
          <div role="region" aria-label={t("compare.caption")} tabIndex={0} className="mt-3 overflow-x-auto rounded-xl border border-line bg-bg md:mt-10">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <caption className="sr-only">{t("compare.caption")}</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="sticky left-0 z-10 w-40 bg-bg px-4 py-3 font-mono text-xs font-normal uppercase tracking-wider text-muted">
                    {t("compare.feature")}
                  </th>
                  {compareCols.map((c, i) => (
                    <th key={c} scope="col" className={`px-4 py-3 align-bottom font-semibold ${i === 0 ? "bg-accent/[0.07] text-accent" : "text-ink"}`}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {compareRows.map((r) => (
                  <tr key={r.k}>
                    <th scope="row" className="sticky left-0 z-10 bg-bg px-4 py-3 align-top font-medium text-muted">
                      {r.k}
                    </th>
                    {r.cells.map((c, i) => (
                      <td key={i} className={`px-4 py-3 align-top ${i === 0 ? "bg-accent/[0.07] text-ink" : c === t("compare.unknown") ? "italic text-muted" : "text-ink/85"}`}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-3xl text-sm text-muted">{t("compare.note")}</p>
        </Section>

        {/* 8. For your AI agent */}
        <Section id="agents" index="11" eyebrow={t("agents.eyebrow")} title={t("agents.h2")} lead={t("agents.lead")}>
          <div className="mt-10 grid gap-8 lg:grid-cols-[1.5fr_1fr]">
            <CopyBlock id="agent-prompt" text={AGENT_PROMPT} label={t("agents.copy")} copied={t("agents.copied")} caption={t("agents.caption")} />
            <div>
              <h3 className="text-base font-semibold text-ink">{t("agents.docsTitle")}</h3>
              <ul className="mt-3 divide-y divide-line border-y border-line text-sm">
                <li className="py-2">
                  <Ext href={`${REPO_BLOB}/AGENTS.md`} className="link inline-flex min-h-11 items-center font-mono">
                    AGENTS.md
                  </Ext>
                  <p className="text-muted">{t("agents.agentsMd")}</p>
                </li>
                <li className="py-2">
                  <Ext href={`${REPO_BLOB}/AGENT_SETUP.md`} className="link inline-flex min-h-11 items-center font-mono">
                    AGENT_SETUP.md
                  </Ext>
                  <p className="text-muted">{t("agents.setupMd")}</p>
                </li>
                <li className="py-2">
                  <a href="/llms.txt" className="link inline-flex min-h-11 items-center font-mono">
                    llms.txt
                  </a>
                  <p className="text-muted">{t("agents.llms")}</p>
                </li>
              </ul>
            </div>
          </div>
        </Section>

        {/* 9. Risks & safety */}
        <Section id="risks" index="12" eyebrow={t("risks.eyebrow")} title={t("risks.h2")} lead={t("risks.lead")} tone="surface">
          <ul className="mt-10 grid gap-4 md:grid-cols-2">
            {risks.map((r) => (
              <li key={r.t} className="rounded-xl border border-line bg-bg p-5">
                <h3 className="flex items-start gap-3 font-semibold text-ink">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                  {r.t}
                </h3>
                <p className="mt-1.5 pl-[18px] text-muted">{r.d}</p>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap gap-x-6 text-sm">
            <Ext href={`${REPO_BLOB}/SECURITY.md`} className="link inline-flex min-h-11 items-center">
              {t("risks.security")}
            </Ext>
            <Ext href={`${REPO_BLOB}/docs/warnings.md`} className="link inline-flex min-h-11 items-center">
              {t("risks.warnings")}
            </Ext>
          </div>
        </Section>

        {/* 10. FAQ */}
        <Section id="faq" index="13" eyebrow={t("faq.eyebrow")} title={t("faq.h2")} backdrop={<ShotBackdrop id="voxels" drift={60} />}>
          <div className="mt-10 divide-y divide-line rounded-xl border border-line">
            {faq.map((f, i) => (
              <details key={i} className="group px-5 sm:px-6">
                <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-4 py-4 text-base font-semibold text-ink sm:text-lg">
                  <h3 className="font-semibold">{f.q}</h3>
                  <span aria-hidden="true" className="font-mono text-xl text-accent transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="max-w-3xl pb-5 text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* 11. Open source */}
        <Section id="opensource" index="14" eyebrow={t("opensource.eyebrow")} title={t("opensource.h2")} lead={t("opensource.lead")} tone="surface">
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Ext href={REPO} className="btn-primary min-h-12 px-6" track="cta_click" p="github">
              {t("opensource.repo")}
            </Ext>
            <Ext href={GOOD_FIRST_ISSUES} className="btn-secondary min-h-12 px-6">
              {t("opensource.issues")}
            </Ext>
          </div>
          <h3 className="mt-12 text-base font-semibold text-ink">{t("opensource.thanksTitle")}</h3>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {thanks.map((x) => (
              <li key={x.name} className="rounded-xl border border-line bg-bg p-5">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <Ext href={x.href} className="link inline-flex min-h-11 items-center font-semibold">
                    {x.name}
                  </Ext>
                  <span className="font-mono text-xs text-muted">{x.license}</span>
                </p>
                <p className="mt-2 text-sm text-muted">{x.d}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* 12. Contact */}
        <Section id="contact" index="15" eyebrow={t("contact.eyebrow")} title={t("contact.h2")} backdrop={<ShotBackdrop id="flight-tunis" />}>
          <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_1.15fr]">
            <div>
              <p className="text-xl font-semibold text-ink">{AUTHOR.name}</p>
              <p className="mt-1 text-muted">{t("contact.role")}</p>
              <p className="mt-6 border-l-2 border-accent pl-4 text-lg text-ink">{t("contact.open")}</p>
              <p className="mt-6 text-muted">{t("contact.partner")}</p>
              <ul className="mt-6 grid gap-1 text-base sm:grid-cols-2">
                <li>
                  <Ext href={AUTHOR.linkedin} className="link inline-flex min-h-11 items-center" track="cta_click" p="linkedin">
                    LinkedIn
                  </Ext>
                </li>
                <li>
                  <Ext href={AUTHOR.calendar} className="link inline-flex min-h-11 items-center" track="cta_click" p="calendar">
                    {t("contact.calendar")}
                  </Ext>
                </li>
                <li>
                  <a href={`mailto:${AUTHOR.email}`} data-track="cta_click" data-p="email" className="link inline-flex min-h-11 items-center">
                    {AUTHOR.email}
                  </a>
                </li>
                <li>
                  <Ext href={AUTHOR.github} className="link inline-flex min-h-11 items-center" track="cta_click" p="github">
                    GitHub
                  </Ext>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="mb-4 text-lg font-semibold text-ink">{t("contact.formTitle")}</h3>
              <LeadForm />
            </div>
          </div>
        </Section>
      </main>

      <Footer locale={locale} page="" />
      <StickyCTA locale={locale} label={t("sticky.cta")} note={t("sticky.note")} />
    </>
  );
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  return <Landing locale={locale as Locale} />;
}
