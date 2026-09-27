import manifest from "@/config/shots.json";
import { SITE } from "@/config/site";

/**
 * Real screenshots of the live simulator. config/shots.json is written by
 * tools/bench/src/screens.ts (the capture script, re-run after a release); the WebP files are in
 * public/shots/, the captions in the site dictionaries under shots.items.<id>.
 */
export type ShotVariant = { src: string; w: number; h: number; bytes: number; quality: number };
export type Shot = { id: string; device: "desktop" | "mobile"; raw: { w: number; h: number }; large: ShotVariant; small: ShotVariant };
export type ShotCaption = { t: string; d: string };

export const SHOTS = manifest.items as Shot[];
/** The day the pictures were taken (YYYY-MM-DD). */
export const SHOT_DATE = manifest.shotAt;

export function shot(id: string): Shot {
  const s = SHOTS.find((x) => x.id === id);
  if (!s) throw new Error(`no screenshot "${id}" in config/shots.json: run tools/bench/src/screens.ts`);
  return s;
}

export const srcSet = (s: Shot) => `${s.small.src} ${s.small.w}w, ${s.large.src} ${s.large.w}w`;

export const shotDate = (locale: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${SHOT_DATE}T12:00:00Z`));

/** For JSON-LD: absolute URLs of the large files. */
export const absolute = (s: Shot) => `${SITE}${s.large.src}`;
