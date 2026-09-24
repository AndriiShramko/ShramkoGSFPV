import { useFormatter, useTranslations } from "next-intl";
import numbers from "@/generated/numbers.json";
import { EVIDENCE_URL } from "@/config/site";
import { Ext } from "./kit";

type Item = { value: string; method: string; date: string };
type Latency = Item & {
  status: string;
  outputHz: number;
  medianMs: number;
  p95Ms: number;
  blankPageFloorMs: number;
  conditions: string;
  cameraMeasured: boolean;
  displayHz: number | null;
};

const KEYS = ["ratesVectors", "tunnelling", "clearance"] as const;

/**
 * Renders ONLY from src/generated/numbers.json (copied from evidence/latest.json at build time
 * by scripts/numbers.mjs, which fails the build when a key is missing). Values and methods are
 * quoted verbatim in English; labels around them are translated.
 */
export default function LiveNumbers() {
  const t = useTranslations("numbers");
  const f = useFormatter();
  const items = numbers.items as unknown as Record<(typeof KEYS)[number], Item> & { latency: Latency };
  const lat = items.latency;
  const num = (n: number) => f.number(n, { maximumFractionDigits: 1 });
  const status = lat.status === "LIMITED BY DISPLAY" ? t("latency.displayLimited") : lat.status;

  return (
    <div className="mt-10">
      <div className="grid gap-4 md:grid-cols-3">
        {KEYS.map((k) => (
          <article key={k} className="flex flex-col rounded-xl border border-line bg-surface p-5 sm:p-6" data-testid={`num-${k}`}>
            <h3 className="eyebrow text-muted">{t(`labels.${k}`)}</h3>
            <p lang="en" className="mt-3 text-xl font-semibold leading-snug tracking-tight text-ink">
              {items[k].value}
            </p>
            <dl className="mt-auto pt-5 text-sm">
              <dt className="text-muted">{t("method")}</dt>
              <dd lang="en" className="mt-0.5 text-ink/90">
                {items[k].method}
              </dd>
              <dt className="mt-3 text-muted">{t("date")}</dt>
              <dd className="mt-0.5 font-mono text-ink/90">{items[k].date}</dd>
            </dl>
          </article>
        ))}
      </div>

      <article className="mt-4 rounded-xl border border-warn/35 bg-surface p-5 sm:p-6" data-testid="num-latency">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="eyebrow text-muted">{t("labels.latency")}</h3>
          <span className="inline-flex items-center rounded-full border border-warn/50 px-3 py-0.5 font-mono text-xs uppercase tracking-wider text-warn">{status}</span>
        </div>
        <p className="mt-3 max-w-3xl text-lg text-ink">{lat.displayHz ? t("latency.explain", { hz: num(lat.displayHz) }) : t("latency.explainNoHz")}</p>
        {lat.cameraMeasured ? null : <p className="mt-2 max-w-3xl font-semibold text-ink">{t("latency.camera")}</p>}
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">{t("latency.outputHz")}</dt>
            <dd className="font-mono text-ink/90">{num(lat.outputHz)} {t("units.hz")}</dd>
          </div>
          <div>
            <dt className="text-muted">{t("latency.median")}</dt>
            <dd className="font-mono text-ink/90">{num(lat.medianMs)} {t("units.ms")}</dd>
          </div>
          <div>
            <dt className="text-muted">{t("latency.p95")}</dt>
            <dd className="font-mono text-ink/90">{num(lat.p95Ms)} {t("units.ms")}</dd>
          </div>
          <div>
            <dt className="text-muted">{t("latency.floor")}</dt>
            <dd className="font-mono text-ink/90">{num(lat.blankPageFloorMs)} {t("units.ms")}</dd>
          </div>
        </dl>
        <dl className="mt-4 space-y-2 text-sm">
          <div>
            <dt className="inline text-muted">{t("latency.conditions")}: </dt>
            <dd lang="en" className="inline text-ink/90">
              {lat.conditions}
            </dd>
          </div>
          <div>
            <dt className="inline text-muted">{t("method")}: </dt>
            <dd lang="en" className="inline text-ink/90">
              {lat.method}
            </dd>
          </div>
          <div>
            <dt className="inline text-muted">{t("date")}: </dt>
            <dd className="inline font-mono text-ink/90">{lat.date}</dd>
          </div>
        </dl>
      </article>

      <div className="mt-5 flex flex-col gap-2 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          {t("quoteNote")} {t("updated", { date: numbers.updated.slice(0, 10) })}
        </p>
        <Ext href={EVIDENCE_URL} className="link inline-flex min-h-11 items-center">
          {t("evidenceLink")}
        </Ext>
      </div>
    </div>
  );
}
