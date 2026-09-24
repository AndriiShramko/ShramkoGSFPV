import { LOCALE_NAMES, routing, type Locale } from "@/i18n/routing";

/**
 * Four real links to the same page in the other languages (work with JS off).
 * ClickTracker stores the choice in the NEXT_LOCALE cookie before the navigation happens.
 */
export default function LangSwitcher({ locale, page, label, where }: { locale: Locale; page: string; label: string; where: "nav" | "footer" }) {
  // The header copy is the language landmark; the footer copy is a plain labelled group so the
  // page does not carry two landmarks with the same name.
  const Wrap = where === "nav" ? "nav" : "div";
  return (
    <Wrap aria-label={label} data-testid={`lang-${where}`} {...(where === "nav" ? {} : { role: "group" })}>
      <ul className="flex items-center gap-1">
        {routing.locales.map((l) => {
          const active = l === locale;
          return (
            <li key={l}>
              <a
                href={`/${l}/${page}`}
                hrefLang={l}
                lang={l}
                title={LOCALE_NAMES[l]}
                {...(active ? { "aria-current": "page" as const } : {})}
                data-lang={l}
                className={
                  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 font-mono text-[13px] font-medium uppercase tracking-wide " +
                  (active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface hover:text-ink")
                }
              >
                {l}
                <span className="sr-only"> {LOCALE_NAMES[l]}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </Wrap>
  );
}
