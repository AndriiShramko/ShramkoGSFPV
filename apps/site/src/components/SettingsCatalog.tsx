import { useTranslations } from "next-intl";
import features from "@/generated/features.json";
import { REPO_BLOB, SHOWCASE, flyPath } from "@/config/site";
import type { Locale } from "@/i18n/routing";
import CatalogTools from "./CatalogTools";
import { Ext } from "./kit";
import "./SettingsCatalog.css";

/**
 * "Everything you can tune" (docs/architecture-v03.md I.3): every shipped setting, keyboard key and
 * drone preset, rendered ONLY from src/generated/features.json. scripts/gen-catalog.ts writes that
 * file from the simulator's settings schema, keymap and presets (the site never imports simulator
 * packages); CI fails when it is stale. Everything is server-rendered and readable without
 * JavaScript; CatalogTools only filters the rows it finds by their data attributes.
 */

type Setting = {
  id: string;
  label: string;
  help: string;
  type: "bool" | "number" | "enum" | "json";
  default: string;
  range: string;
  scope: "global" | "drone" | "scene";
  keys: string[];
  advanced: boolean;
  preset: boolean;
  options: string[];
  shown: string[];
};
type Group = { id: string; title: string; settings: Setting[] };
type Field = { label: string; value: string; kind: string; sourceLabel: string };
type Catalogue = {
  groups: Group[];
  keys: { action: string; label: string; keys: string[] }[];
  flying: { label: string; keys: string[] }[];
  drones: { id: string; name: string; fields: Field[] }[];
};
type Features = {
  generated: string;
  defaultDrone: string;
  counts: { settings: number; groups: number; drones: number; modes: number; rateTypes: number; allKeys: number };
  locales: Record<string, Catalogue>;
};

const DATA = features as unknown as Features;

/** Search text: lower case without accents, so "voxeles" finds "vóxeles". CatalogTools folds the query the same way. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Two columns of whole cards, split where the heights balance best, in schema order (a phone reads them top to bottom). */
function split(groups: Group[]): [Group[], Group[]] {
  const w = groups.map((g) => 1.5 + g.settings.length);
  const total = w.reduce((a, b) => a + b, 0);
  let best = groups.length;
  let diff = Infinity;
  for (let k = 1, acc = 0; k <= groups.length; k++) {
    acc += w[k - 1];
    const d = Math.abs(total - 2 * acc);
    if (d < diff) [best, diff] = [k, d];
  }
  return [groups.slice(0, best), groups.slice(best)];
}

const SRC: Record<string, string> = {
  measured: "border-accent/50 text-accent",
  manufacturer: "border-line-strong text-muted",
  "bf-default": "border-line-strong text-muted",
  estimate: "border-dashed border-line-strong text-muted",
  other: "border-line-strong text-muted",
};

function Keys({ keys, label }: { keys: string[]; label?: string }) {
  return (
    <span className="flex shrink-0 flex-wrap justify-end gap-1">
      {label ? <span className="sr-only">{label}: </span> : null}
      {keys.map((k) => (
        <kbd key={k} className="tc-kbd">
          {k}
        </kbd>
      ))}
    </span>
  );
}

function Row({ s, group, locale, t }: { s: Setting; group: Group; locale: Locale; t: ReturnType<typeof useTranslations<"tune">> }) {
  const hay = fold([s.label, s.help, s.id, s.default, s.range, ...s.options, ...s.keys, group.title].join(" "));
  const link = s.shown.includes("settings") ? `${flyPath(locale)}?open=settings&focus=${encodeURIComponent(s.id)}` : null;
  return (
    <li data-tc-row="" data-tc-group={group.id} data-tc-q={hay}>
      <details className="tc-row group/row">
        <summary className="flex min-h-14 items-start gap-3 px-4 py-3 sm:px-5">
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium leading-snug text-ink">{s.label}</span>
              {s.scope !== "global" ? <span className={`tc-badge is-${s.scope}`}>{t(`scope.${s.scope}`)}</span> : null}
              {s.advanced ? <span className="tc-badge">{t("adv")}</span> : null}
            </span>
            <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5 text-muted">
              {s.default ? (
                <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="tc-cap">{t("default")}</span>
                  <span className="tc-val">{s.default}</span>
                  {s.preset ? <span>{t("preset")}</span> : null}
                </span>
              ) : s.preset ? (
                <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="tc-cap">{t("default")}</span>
                  <span>{t("preset")}</span>
                </span>
              ) : null}
              {s.options.length ? (
                <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="tc-cap">{t("options")}</span>
                  <span className="font-mono text-ink/80">{s.options.length}</span>
                </span>
              ) : s.range ? (
                <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="tc-cap">{t("range")}</span>
                  <span className="font-mono text-ink/80">{s.range}</span>
                </span>
              ) : null}
            </span>
          </span>
          {s.keys.length ? <Keys keys={s.keys} label={t("keys.title")} /> : null}
          <span aria-hidden="true" className="tc-plus">
            +
          </span>
        </summary>
        <div className="px-4 pb-4 sm:px-5">
          <p className="max-w-prose text-[15px] leading-relaxed text-ink/85">{s.help}</p>
          {s.options.length ? (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("options")}>
              {s.options.map((o) => (
                <li key={o} className={`tc-opt ${o === s.default ? "is-default" : ""}`}>
                  {o}
                  {o === s.default ? <span className="sr-only"> ({t("default")})</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 flex flex-wrap items-center gap-x-4 font-mono text-xs text-muted">
            <span>{s.id}</span>
            {link ? (
              <a href={link} className="link inline-flex min-h-11 items-center font-sans text-sm">
                {t("open")}
                <span aria-hidden="true" className="ml-1">
                  →
                </span>
              </a>
            ) : null}
          </p>
        </div>
      </details>
    </li>
  );
}

function GroupCard({ g, n, locale, t }: { g: Group; n: number; locale: Locale; t: ReturnType<typeof useTranslations<"tune">> }) {
  return (
    <article data-tc-card="" aria-labelledby={`tc-g-${g.id}`} className="overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <h3 id={`tc-g-${g.id}`} className="flex items-center gap-3 text-lg font-semibold text-ink">
          <span aria-hidden="true" className="font-mono text-xs font-normal text-accent">
            {String(n).padStart(2, "0")}
          </span>
          {g.title}
        </h3>
        <span aria-hidden="true" className="rounded-full border border-line-strong px-2 font-mono text-xs leading-5 text-muted">
          {g.settings.length}
        </span>
      </header>
      <ul className="divide-y divide-line">
        {g.settings.map((s) => (
          <Row key={s.id} s={s} group={g} locale={locale} t={t} />
        ))}
      </ul>
    </article>
  );
}

export default function SettingsCatalog({ locale }: { locale: Locale }) {
  const t = useTranslations("tune");
  const cat = DATA.locales[locale] ?? DATA.locales.en;
  const c = DATA.counts;
  const fly = flyPath(locale);
  const [left, right] = split(cat.groups);
  const order = new Map(cat.groups.map((g, i) => [g.id, i + 1]));
  const tiles: [string, number][] = [
    ["settings", c.settings],
    ["groups", c.groups],
    ["keys", c.allKeys],
    ["drones", c.drones],
    ["rateTypes", c.rateTypes],
    ["modes", c.modes],
  ];
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${DATA.generated}T12:00:00Z`));
  const scene = SHOWCASE[0].id;

  return (
    <div data-tc-root="" className="relative mt-10">
      <div aria-hidden="true" className="tc-grid" />
      <dl className="relative grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-6">
        {tiles.map(([k, n], i) => (
          <div key={k} className={`flex flex-col-reverse justify-end gap-1 rounded-xl border bg-bg p-3 sm:p-4 ${i === 0 ? "border-accent/40" : "border-line"}`}>
            <dt className="text-[13px] leading-snug text-muted sm:text-sm">{t(`count.${k}`)}</dt>
            <dd className={`font-mono text-2xl font-semibold leading-none sm:text-4xl ${i === 0 ? "text-accent" : "text-ink"}`}>{n}</dd>
          </div>
        ))}
      </dl>

      <CatalogTools
        total={c.settings}
        groups={cat.groups.map((g) => ({ id: g.id, title: g.title, n: g.settings.length }))}
        labels={{ search: t("search.label"), placeholder: t("search.placeholder"), clear: t("search.clear"), filter: t("filter.label"), all: t("filter.all"), shown: t.raw("shown") as string }}
      />
      <p className="relative mt-3 max-w-3xl text-sm text-muted">{t("scopeNote")}</p>

      <div className="relative mt-6 flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start">
        {[left, right].map((col, i) =>
          col.length ? (
            <div key={i} data-tc-col="" className="flex flex-col gap-5">
              {col.map((g) => (
                <GroupCard key={g.id} g={g} n={order.get(g.id) ?? 0} locale={locale} t={t} />
              ))}
            </div>
          ) : null,
        )}
      </div>
      <p data-tc-empty="" hidden className="relative mt-6 rounded-xl border border-dashed border-line-strong p-6 text-center text-muted">
        {t("empty")}
      </p>

      <div className="relative mt-10 grid gap-5 lg:grid-cols-2">
        <article aria-labelledby="tc-keys" className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <h3 id="tc-keys" className="text-xl font-semibold text-ink">
            {t("keys.title")}
          </h3>
          <p className="mt-1 text-sm text-muted">{t("keys.note")}</p>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {cat.keys.map((k) => (
              <li key={k.action} className="flex min-h-11 items-center justify-between gap-4 py-2">
                <span className="text-[15px] text-ink/90">{k.label}</span>
                <Keys keys={k.keys} />
              </li>
            ))}
          </ul>
        </article>
        <article aria-labelledby="tc-flying" className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <h3 id="tc-flying" className="text-xl font-semibold text-ink">
            {t("keys.flying")}
          </h3>
          <p className="mt-1 text-sm text-muted">{t("keys.flyingNote")}</p>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {cat.flying.map((k) => (
              <li key={k.label} className="flex min-h-11 items-center justify-between gap-4 py-2">
                <span className="text-[15px] text-ink/90 first-letter:uppercase">{k.label}</span>
                <Keys keys={k.keys} />
              </li>
            ))}
          </ul>
        </article>
      </div>

      <div className="relative mt-5">
        <article aria-labelledby="tc-drones" className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <h3 id="tc-drones" className="text-xl font-semibold text-ink">
            {t("drones.title", { n: cat.drones.length })}
          </h3>
          <p className="mt-1 text-sm text-muted">{t("drones.note")}</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cat.drones.map((d) => (
              <li key={d.id} className="flex flex-col rounded-lg border border-line bg-bg p-4">
                <p className="flex flex-wrap items-center gap-2 font-semibold leading-snug text-ink">
                  {d.name}
                  {d.id === DATA.defaultDrone ? <span className="tc-badge is-drone">{t("drones.default")}</span> : null}
                </p>
                <dl className="mt-3 space-y-1.5 text-[13px]">
                  {d.fields.map((f) => (
                    <div key={f.label} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3">
                      <dt className="text-muted">{f.label}</dt>
                      <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-ink">{f.value}</span>
                        <span className={`inline-flex whitespace-nowrap rounded-full border px-1.5 text-[11px] leading-[18px] ${SRC[f.kind] ?? SRC.other}`}>{f.sourceLabel}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
                <a href={`${fly}?scene=${scene}&drone=${encodeURIComponent(d.id)}`} className="link mt-auto inline-flex min-h-11 items-center pt-3 text-sm">
                  {t("drones.fly")}
                  <span className="sr-only">: {d.name}</span>
                  <span aria-hidden="true" className="ml-1">
                    →
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <div className="relative mt-8 flex flex-col gap-4 rounded-xl border border-accent/30 bg-bg p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <p className="min-w-0 max-w-2xl text-sm text-muted lg:flex-1">{t("footer.note", { date })}</p>
        <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
          <Ext href={`${REPO_BLOB}/docs/settings.md`} className="btn-secondary min-h-12 shrink-0 px-5">
            {t("footer.docs")}
          </Ext>
          <a href={fly} className="btn-primary min-h-12 shrink-0 px-6">
            {t("footer.cta")}
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </div>
  );
}
