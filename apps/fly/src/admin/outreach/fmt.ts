// How the Outreach tab writes numbers, times and the words of stored values (states, verdicts ...) in the
// admin's language. A value the dictionaries do not know is shown as it is stored (underscores as spaces),
// so a state a later campaign adds is readable at once, only not translated.
import { locale, t } from '../i18n';
import { ageParts } from './model';

const NF = new Intl.NumberFormat(locale);

export const int = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : NF.format(n));
export const num = (n: number | null | undefined, digits = 1): string =>
    n === null || n === undefined ? '—' : new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(n);
export const percent = (x: number | null | undefined): string => (x === null || x === undefined ? '—' : `${Math.round(100 * x)}%`);

function time(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}

export function date(iso: string | null | undefined): string {
    const d = time(iso);
    return d ? d.toLocaleDateString(locale, { year: '2-digit', month: '2-digit', day: '2-digit' }) : '—';
}

export function dateTime(iso: string | null | undefined): string {
    const d = time(iso);
    return d ? d.toLocaleString(locale, { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
}

/** "3 h", "2 d" in the admin's language. */
export function age(h: number | null | undefined): string {
    const a = ageParts(h ?? null);
    return a ? t(`admin.outreach.unit.${a.unit}`, { n: a.n }) : '—';
}

/** The word for a stored value: group `admin.outreach.<group>.<value>`, else the value itself, spaced. */
export function word(group: string, value: string | null | undefined): string {
    if (value === null || value === undefined || value === '') return t('admin.outreach.filter.none');
    const key = `admin.outreach.${group}.${value}`;
    const w = t(key);
    return w === key ? value.replace(/_/g, ' ') : w;
}

/** The label of a checkpoint (hours after the post): +1 h, +24 h, +72 h, +7 d, +30 d. */
export const checkpoint = (cp: number): string => t(`admin.outreach.cp.${cp}`);
