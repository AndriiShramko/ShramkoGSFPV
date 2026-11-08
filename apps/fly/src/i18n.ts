// Tiny t() for the simulator. Language: the /{locale}/fly/ path, then the NEXT_LOCALE cookie the
// landing page writes, then the browser language. A manual choice is stored in the same cookie.
import en from '@gsfpv/i18n/fly/en.json';
import es from '@gsfpv/i18n/fly/es.json';
import pl from '@gsfpv/i18n/fly/pl.json';
import ru from '@gsfpv/i18n/fly/ru.json';

export type Locale = 'en' | 'es' | 'pl' | 'ru';
export const LOCALES: Locale[] = ['en', 'es', 'pl', 'ru'];

// Namespaced dictionaries, locales/fly/<ns>/<lang>.json (docs/architecture-v03.md 1.3): each
// feature adds its keys in its own files, so parallel work never edits the same four files. A glob
// takes a path, not a package name, hence the walk up to packages/. Every key lives in exactly one
// file (packages/i18n/test/fly-parity.test.ts), so the merge order cannot decide a text.
// The recorder's namespace (sonicrec, about 54 KB in four languages) is not among them: it comes with the session side's lazy
// chunk, which adds it when it loads (sonic-session/texts.ts, addDictionaries), so a page without Fly by Sound never carries it.
// Nor are the mode's own (sonic: the start screen, its notes and spoken lines; sonickeys: the names of its keys, which exist only
// in the mode; soniclook: the words of its sound panel and attitude display, v0.13), which come with the start chunk (sonic/texts.ts,
// v12-optin); of Fly by Sound every page keeps only sonicentry (the pause menu's way in, the note that the mode did not load).
const NAMESPACED = import.meta.glob<Record<string, string>>(
    ['../../../packages/i18n/locales/fly/*/*.json', '!../../../packages/i18n/locales/fly/sonicrec/*.json', '!../../../packages/i18n/locales/fly/sonic/*.json', '!../../../packages/i18n/locales/fly/sonickeys/*.json', '!../../../packages/i18n/locales/fly/soniclook/*.json'],
    { eager: true, import: 'default' }
);

function merged(l: Locale, flat: Record<string, string>): Record<string, string> {
    const out = { ...flat };
    for (const [path, d] of Object.entries(NAMESPACED)) if (path.endsWith(`/${l}.json`)) Object.assign(out, d);
    return out;
}

const DICTS: Record<Locale, Record<string, string>> = { en: merged('en', en), es: merged('es', es), pl: merged('pl', pl), ru: merged('ru', ru) };

/** Adds the files of a namespace a lazy chunk brought (`.../<lang>.json` paths, as import.meta.glob gives them) to t()'s dictionaries. */
export function addDictionaries(files: Record<string, Record<string, string>>): void {
    for (const [path, d] of Object.entries(files)) for (const l of LOCALES) if (path.endsWith(`/${l}.json`)) Object.assign(DICTS[l], d);
}

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
