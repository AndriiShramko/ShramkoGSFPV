import type { Metadata } from "next";
import { SITE } from "@/config/site";
import { OG_LOCALE, routing, type Locale } from "@/i18n/routing";

/** Per-page metadata: own canonical, hreflang for every locale + x-default, OG/Twitter. */
export function pageMetadata({ locale, page, title, description }: { locale: Locale; page: string; title: string; description: string }): Metadata {
  const url = (l: string) => `${SITE}/${l}/${page}`;
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = url(l);
  languages["x-default"] = url(routing.defaultLocale);
  return {
    metadataBase: new URL(SITE),
    title,
    description,
    authors: [{ name: "Andrii Shramko", url: "https://www.linkedin.com/in/andrii-shramko/" }],
    creator: "Andrii Shramko",
    alternates: { canonical: url(locale), languages },
    openGraph: {
      type: "website",
      siteName: "ShramkoGSFPV",
      title,
      description,
      url: url(locale),
      locale: OG_LOCALE[locale],
      alternateLocale: routing.locales.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
      images: [{ url: `${SITE}/og.png`, width: 1200, height: 630, alt: "ShramkoGSFPV" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [`${SITE}/og.png`] },
    robots: { index: true, follow: true },
    icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
  };
}
