import type { Metadata } from "next";
import common from "@gsfpv/i18n/common.json";

export const metadata: Metadata = {
  title: "ShramkoGSFPV — 404",
  robots: { index: false, follow: true },
};

const LINKS = (["en", "es", "pl", "ru"] as const).map((l) => ({ l, text: common.notFound[l] }));

/** Static 404 for nginx (out/404.html). Not tied to a locale, so it speaks all four. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center px-4 py-16">
      <p className="eyebrow">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">ShramkoGSFPV</h1>
      <ul className="mt-6 space-y-1">
        {LINKS.map((x) => (
          <li key={x.l} lang={x.l}>
            <a href={`/${x.l}/`} hrefLang={x.l} className="link inline-flex min-h-11 items-center">
              {x.text}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
