import { useTranslations } from "next-intl";
import ShotImage from "./ShotImage";
import { panel, shot } from "@/lib/shots";
import type { ShotCaption } from "@/lib/shots";

type FeatureGroup = { t: string; items: string[] };

/**
 * Each feature group of the "Available now" board next to the screens that show it: a large
 * screenshot (1) and a second one (2) overlapping it, the numbers matching the captions. A menu
 * shows as its crop (the menu itself, readable at this size; the gallery has the whole screen),
 * a flight or the voxel grid as the whole screen. The order follows features.groups in the
 * dictionaries.
 */
const TOUR: { main: string; side: string }[] = [
  { main: "wizard-throttle", side: "wizard-check" },
  { main: "keys", side: "m-touch" },
  { main: "drones", side: "betaflight" },
  { main: "crash", side: "m-crash" },
  { main: "flight-tunis", side: "cinema" },
  { main: "voxels", side: "walls" },
];

/** The picture's number, never over the screenshot itself: in the picture's window bar, or hanging off a phone's rounded corner. */
function Num({ n, where }: { n: number; where: "bar" | "hang" }) {
  return (
    <span aria-hidden="true" className={`shot-num ${where === "bar" ? "in-bar" : "hang"}`}>
      {n}
    </span>
  );
}

export default function Tour() {
  const t = useTranslations();
  const groups = t.raw("features.groups") as FeatureGroup[];
  const rows = t.raw("shots.tour.rows") as string[];
  const caps = t.raw("shots.items") as Record<string, ShotCaption>;
  return (
    <ol className="mt-14 space-y-24 sm:mt-20 sm:space-y-32 xl:-mx-12">
      {TOUR.map((r, i) => {
        const g = groups[i];
        if (!g) return null;
        const flip = i % 2 === 1;
        const main = panel(shot(r.main));
        const side = panel(shot(r.side));
        const phone = side.device === "mobile";
        return (
          <li key={r.main}>
            <figure data-parallax-host className="grid items-center gap-10 lg:grid-cols-12 lg:gap-12">
              <div className={`relative isolate lg:col-span-7 ${flip ? "lg:order-2" : ""}`}>
                <div aria-hidden="true" className="shot-glow" />
                <div className="shot-frame">
                  <div aria-hidden="true" className="shot-frame-bar">
                    <i />
                    <i />
                    <i />
                    <Num n={1} where="bar" />
                  </div>
                  <ShotImage shot={main} defer sizes="(min-width: 1280px) 680px, (min-width: 1024px) 56vw, 100vw" alt={caps[main.id]?.t ?? ""} className="block h-auto w-full" />
                </div>
                <div data-parallax data-py={-40} className={`shot-side ${phone ? "is-phone" : ""} ${flip ? "on-left" : "on-right"}`}>
                  {phone ? null : (
                    <div aria-hidden="true" className="shot-frame-bar is-small">
                      <i />
                      <i />
                      <i />
                      <Num n={2} where="bar" />
                    </div>
                  )}
                  <ShotImage shot={side} defer sizes={phone ? "(min-width: 1024px) 160px, 34vw" : "(min-width: 1024px) 380px, 70vw"} alt={caps[side.id]?.t ?? ""} className="block h-auto w-full" />
                  {phone ? <Num n={2} where="hang" /> : null}
                </div>
              </div>
              <figcaption className={`lg:col-span-5 ${flip ? "lg:order-1" : ""}`}>
                <h3 className="text-2xl font-semibold text-ink sm:text-3xl">{g.t}</h3>
                <p className="mt-4 text-lg text-ink/85">{rows[i]}</p>
                <dl className="mt-7 space-y-4">
                  {[main, side].map((s, k) => (
                    <div key={s.id}>
                      <dt className="flex items-start gap-3 font-semibold text-ink">
                        <span aria-hidden="true" className="shot-num static mt-0.5 shrink-0">
                          {k + 1}
                        </span>
                        {caps[s.id]?.t}
                      </dt>
                      <dd className="mt-0.5 pl-9 text-sm text-muted">{caps[s.id]?.d}</dd>
                    </div>
                  ))}
                </dl>
                <a href="#features" className="mt-7 inline-flex min-h-11 items-center gap-3 whitespace-nowrap rounded-full border border-accent/40 px-4 text-sm text-ink transition-colors hover:border-accent">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                  {t("shots.tour.live", { n: g.items.length })}
                  {/* on a phone the pill keeps one line: the second half is for screen readers there */}
                  <span className="sr-only sm:not-sr-only sm:text-muted">
                    <span aria-hidden="true" className="mr-3 text-line-strong">
                      ·
                    </span>
                    {t("shots.tour.all")}
                  </span>
                  <span aria-hidden="true">→</span>
                </a>
              </figcaption>
            </figure>
          </li>
        );
      })}
    </ol>
  );
}
