import type { MetadataRoute } from "next";
import { SITE } from "@/config/site";
import { routing } from "@/i18n/routing";

export const dynamic = "force-static";

const PAGES = [
  { path: "", priority: 1, changeFrequency: "weekly" as const },
  { path: "privacy/", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "licenses/", priority: 0.3, changeFrequency: "monthly" as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-09-24");
  return PAGES.flatMap((pg) => {
    const languages: Record<string, string> = {};
    for (const l of routing.locales) languages[l] = `${SITE}/${l}/${pg.path}`;
    languages["x-default"] = `${SITE}/${routing.defaultLocale}/${pg.path}`;
    return routing.locales.map((l) => ({
      url: `${SITE}/${l}/${pg.path}`,
      lastModified,
      changeFrequency: pg.changeFrequency,
      priority: l === routing.defaultLocale ? pg.priority : Math.round(pg.priority * 8) / 10,
      alternates: { languages },
    }));
  });
}
