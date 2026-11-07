// The lines the page says itself in Fly by Sound (v0.12, docs/wip/v12-plan.md 6.2 and 4.2 step 10). The lessons, cues, menus and
// survey speak the sound package's own strings (its locales/); what only the simulator knows (a scan is loading, its walls are
// coarse) is the simulator's, in packages/i18n/locales/fly/sonic/<lang>.json under the keys `sonic.say.*`. The engine speaks any
// SpeechLine through its translator, so its dictionaries are the package's with these keys added: one voice, one caption
// region, one queue for both, and the replay sees them as the host's own lines (a speech event the runner never asked for).
import { DICTS, LOCALES } from '@shramko/sonic-fpv';
import type { Dicts, Locale } from '@shramko/sonic-fpv';

/** The keys the engine speaks for the page start with this. */
export const HOST_PREFIX = 'sonic.say.';

const FILES = import.meta.glob<Record<string, string>>('../../../../packages/i18n/locales/fly/sonic/*.json', { eager: true, import: 'default' });

/** The page's spoken lines in `locale`: the `sonic.say.*` keys of its dictionary. */
export function hostLines(locale: Locale): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [path, d] of Object.entries(FILES)) {
        if (!path.endsWith(`/${locale}.json`)) continue;
        for (const [k, v] of Object.entries(d)) if (k.startsWith(HOST_PREFIX)) out[k] = v;
    }
    return out;
}

/** The engine's dictionaries: the package's, and the page's spoken lines on top (the keys cannot meet: different prefixes). */
export function engineDicts(): Dicts {
    const out = {} as Record<Locale, Record<string, string>>;
    for (const l of LOCALES) out[l] = { ...DICTS[l], ...hostLines(l) };
    return out;
}
