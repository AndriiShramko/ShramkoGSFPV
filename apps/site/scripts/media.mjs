// Prebuild: record which hero media files exist in public/media/. The hero renders the
// background video only when hero.mp4 is really there; otherwise it shows a dark gradient.
// Media is supplied by the simulator build (real screen capture), never faked here.
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SITE = join(here, "..");
const MEDIA = join(SITE, "public", "media");
const OUT = join(SITE, "src", "generated", "media.json");

const nonEmpty = (name) => {
  const p = join(MEDIA, name);
  return existsSync(p) && statSync(p).size > 0;
};

const media = { heroVideo: nonEmpty("hero.mp4"), heroPoster: nonEmpty("hero-poster.jpg") };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(media, null, 2) + "\n", "utf8");
console.log(`media: hero.mp4 ${media.heroVideo ? "present" : "missing (gradient fallback)"}, hero-poster.jpg ${media.heroPoster ? "present" : "missing"}`);
