// A stand-in for apps/fly/src/i18n.ts in the browser probes of the recording panel (tools/bench/src/sonicrec-local.ts): the real module reads its
// dictionaries with Vite's import.meta.glob, which esbuild cannot bundle. This one reads the sonicrec dictionaries from the same
// four JSON files and formats with the same rule as t() (a {name} is replaced, a missing key is the key). The language comes from
// ?lang= so the probe can look at all four.
import en from '../../../packages/i18n/locales/fly/sonicrec/en.json';
import es from '../../../packages/i18n/locales/fly/sonicrec/es.json';
import pl from '../../../packages/i18n/locales/fly/sonicrec/pl.json';
import ru from '../../../packages/i18n/locales/fly/sonicrec/ru.json';

export type Locale = 'en' | 'es' | 'pl' | 'ru';
const DICTS: Record<Locale, Record<string, string>> = { en, es, pl, ru };
const asked = new URL(location.href).searchParams.get('lang');
export const locale: Locale = asked === 'es' || asked === 'pl' || asked === 'ru' ? asked : 'en';
document.documentElement.lang = locale;

export function t(key: string, vars?: Record<string, string | number>): string {
    let s = DICTS[locale][key] ?? DICTS.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
}
