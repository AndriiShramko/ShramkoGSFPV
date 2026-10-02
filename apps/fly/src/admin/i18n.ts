// The admin page's words (packages/i18n/locales/admin/<lang>.json): the language the landing remembered
// (NEXT_LOCALE cookie), else the browser's. Only these dictionaries: the simulator's stay out of this bundle.
import en from '@gsfpv/i18n/admin/en.json';
import es from '@gsfpv/i18n/admin/es.json';
import pl from '@gsfpv/i18n/admin/pl.json';
import ru from '@gsfpv/i18n/admin/ru.json';

const DICTS: Record<string, Record<string, string>> = { en, es, pl, ru };

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
