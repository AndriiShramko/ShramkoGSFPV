// Tiny t() for the simulator. Language: the /{locale}/fly/ path, then the NEXT_LOCALE cookie the
// landing page writes, then the browser language. A manual choice is stored in the same cookie.
import en from '@gsfpv/i18n/fly/en.json';
import es from '@gsfpv/i18n/fly/es.json';
import pl from '@gsfpv/i18n/fly/pl.json';
import ru from '@gsfpv/i18n/fly/ru.json';

export type Locale = 'en' | 'es' | 'pl' | 'ru';
export const LOCALES: Locale[] = ['en', 'es', 'pl', 'ru'];
const DICTS: Record<Locale, Record<string, string>> = { en, es, pl, ru };

function fromPath(): Locale | null {
    const m = location.pathname.match(/^\/(en|es|pl|ru)\//);
    return m ? (m[1] as Locale) : null;
}

function fromCookie(): Locale | null {
    const m = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=(en|es|pl|ru)/);
    return m ? (m[1] as Locale) : null;
}

function fromBrowser(): Locale {
    for (const l of navigator.languages ?? [navigator.language]) {
        const b = l.slice(0, 2).toLowerCase();
        if (b === 'es') return 'es';
        if (b === 'pl') return 'pl';
        if (b === 'ru' || b === 'uk' || b === 'be') return 'ru';
        if (b === 'en') return 'en';
    }
    return 'en';
}

export let locale: Locale = fromPath() ?? fromCookie() ?? fromBrowser();

export function setLocale(l: Locale): void {
    try {
        document.cookie = `NEXT_LOCALE=${l}; path=/; max-age=31536000; samesite=lax`;
    } catch {
        /* cookies disabled */
    }
    locale = l;
    document.documentElement.lang = l;
}

document.documentElement.lang = locale;

export function t(key: string, vars?: Record<string, string | number>): string {
    let s = DICTS[locale][key] ?? DICTS.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
}
