import manifest from "@/config/shots.json";
import { SITE } from "@/config/site";

/**
 * Real screenshots of the simulator. config/shots.json is written by tools/bench/src/screens.ts
 * (the capture script, re-run after a release); the WebP files are in public/shots/, the captions
 * in the site dictionaries under shots.items.<id>.
 * Each shot is the whole screen; a menu shot also has a `panel`: the menu itself with a little of
 * the scene around it, taken at device scale 2 so its text stays readable when shown small.
 */
export type ShotVariant = { src: string; w: number; h: number; bytes: number; quality: number };
export type ShotPanel = { raw: { w: number; h: number }; large: ShotVariant; small: ShotVariant };
export type Shot = { id: string; device: "desktop" | "mobile"; raw: { w: number; h: number }; large: ShotVariant; small: ShotVariant; panel?: ShotPanel };
export type ShotCaption = { t: string; d: string };
/** What a picture on the page shows: the whole screen, or the menu crop when there is one. */
export type ShotView = { id: string; device: Shot["device"]; large: ShotVariant; small: ShotVariant };

export const SHOTS = manifest.items as Shot[];
/** The day the pictures were taken (YYYY-MM-DD). */
export const SHOT_DATE = manifest.shotAt;

export function shot(id: string): Shot {
  const s = SHOTS.find((x) => x.id === id);
  if (!s) throw new Error(`no screenshot "${id}" in config/shots.json: run tools/bench/src/screens.ts`);
  return s;
}

/** The whole screen. */
export const full = (s: Shot): ShotView => ({ id: s.id, device: s.device, large: s.large, small: s.small });
/** The menu itself when the shot has a crop of it, otherwise the whole screen. */
export const panel = (s: Shot): ShotView => (s.panel ? { id: s.id, device: s.device, large: s.panel.large, small: s.panel.small } : full(s));

export const srcSet = (s: ShotView) => `${s.small.src} ${s.small.w}w, ${s.large.src} ${s.large.w}w`;

export const shotDate = (locale: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${SHOT_DATE}T12:00:00Z`));

/** For JSON-LD: absolute URLs of the large files. */
export const absolute = (s: ShotView) => `${SITE}${s.large.src}`;
