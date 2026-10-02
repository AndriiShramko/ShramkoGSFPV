// Prebuild: record which background videos exist in public/media/. A block shows its video only
// when every file of it is really there (H.264 and AV1 at 1280 and 1920 px wide, two WebP posters);
// otherwise it falls back to the poster alone, or to a dark gradient when there is no poster either.
// The files are cut from the owner's own flights recorded in the simulator, never faked here
// (how they were cut and encoded: scripts/encode-videos.sh).
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SITE = join(here, "..");
const MEDIA = join(SITE, "public", "media");
const OUT = join(SITE, "src", "generated", "media.json");

// the loops the landing knows (src/config/videos.ts names which block shows which)
const CLIPS = ["tunis", "garden", "villa"];
const WIDTHS = [1280, 1920];
const POSTERS = [800, 1600];

const size = (name) => {
  const p = join(MEDIA, name);
  return existsSync(p) ? statSync(p).size : 0;
};

const videos = {};
for (const clip of CLIPS) {
  const files = [...WIDTHS.flatMap((w) => [`${clip}-${w}.mp4`, `${clip}-${w}.av1.mp4`]), ...POSTERS.map((w) => `${clip}-poster-${w}.webp`)];
  const bytes = Object.fromEntries(files.map((f) => [f, size(f)]));
  const posters = POSTERS.every((w) => bytes[`${clip}-poster-${w}.webp`] > 0);
  const video = posters && files.every((f) => bytes[f] > 0);
  videos[clip] = { video, posters, bytes };
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ widths: WIDTHS, posters: POSTERS, videos }, null, 2) + "\n", "utf8");
console.log(`media: ${CLIPS.map((c) => `${c} ${videos[c].video ? "video" : videos[c].posters ? "poster only" : "missing (gradient)"}`).join(", ")}`);
