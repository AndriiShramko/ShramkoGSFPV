// The admin page's words: the flat packages/i18n/locales/admin/<lang>.json plus one folder per tab,
// locales/admin/<ns>/<lang>.json (as the simulator's, design 1.3: parallel work never edits the same file;
// a key lives in one file only, packages/i18n/test/admin-parity.test.ts). The language the landing
// remembered (NEXT_LOCALE cookie), else the browser's. Only these dictionaries: the simulator's stay out.
import en from '@gsfpv/i18n/admin/en.json';
import es from '@gsfpv/i18n/admin/es.json';
import pl from '@gsfpv/i18n/admin/pl.json';
import ru from '@gsfpv/i18n/admin/ru.json';

// a glob takes a path, not a package name, hence the walk up to packages/
const NAMESPACED = import.meta.glob<Record<string, string>>('../../../../packages/i18n/locales/admin/*/*.json', { eager: true, import: 'default' });

function merged(l: string, flat: Record<string, string>): Record<string, string> {
    const out = { ...flat };
    for (const [path, d] of Object.entries(NAMESPACED)) if (path.endsWith(`/${l}.json`)) Object.assign(out, d);
    return out;
}

const DICTS: Record<string, Record<string, string>> = { en: merged('en', en), es: merged('es', es), pl: merged('pl', pl), ru: merged('ru', ru) };

function pick(): string {
    const c = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=(en|es|pl|ru)/)?.[1];
    if (c) return c;
    for (const l of navigator.languages ?? [navigator.language]) {
        const b = l.slice(0, 2).toLowerCase();
        if (b === 'uk' || b === 'be') return 'ru';
        if (b in DICTS) return b;
    }
    return 'en';
}

export const locale = pick();
document.documentElement.lang = locale;

export function t(key: string, vars?: Record<string, string | number>): string {
    let s = DICTS[locale][key] ?? DICTS.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
}
