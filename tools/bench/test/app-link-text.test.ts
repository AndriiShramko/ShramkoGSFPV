// What the Controls screen and F3 say about how a device's reports arrive (apps/fly/src/ui/link-text.ts,
// v0.9 lane E), in the four languages with the real strings: the numbers are the meter's, a slow or
// bunched link gets the note that a USB cable is faster, a fast cable or a meter with too little gets
// none. Negative controls: a cable never gets the note, an unknown meter says nothing, and a string
// cannot lose a number (every placeholder is filled in every language).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LinkMeter } from '../../../packages/input/src';
import type { LinkStats } from '../../../packages/input/src';
import { reportTimes } from '../../../packages/input/src/sim';
import type { LinkKind } from '../../../packages/input/src/sim';
import { linkLines, ms } from '../../../apps/fly/src/ui/link-text';

const HERE = dirname(fileURLToPath(import.meta.url));
const LANGS = ['en', 'es', 'pl', 'ru'] as const;
type Lang = (typeof LANGS)[number];

/** The real strings of one language, filled in as apps/fly/src/i18n.ts t() fills them. */
function tFor(lang: Lang): (key: string, vars?: Record<string, string | number>) => string {
    const dict = JSON.parse(readFileSync(join(HERE, '..', '..', '..', 'packages', 'i18n', 'locales', 'fly', 'link', `${lang}.json`), 'utf8')) as Record<string, string>;
    return (key, vars) => {
        const s = dict[key];
        if (s === undefined) throw new Error(`no string ${key} in ${lang}`);
        return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`));
    };
}

const stats = (kind: LinkKind, seed = 1): LinkStats => {
    const m = new LinkMeter();
    for (const t of reportTimes(kind, 3000, seed)) m.note(t);
    return m.stats(3000);
};

describe('ms: milliseconds as a pilot reads them', () => {
    it('one decimal under 10 ms, whole numbers above', () => {
        expect(ms(1)).toBe('1.0');
        expect(ms(8.04)).toBe('8.0');
        expect(ms(11.1)).toBe('11');
        expect(ms(33.3)).toBe('33');
        expect(ms(104.6)).toBe('105');
    });
});

describe('linkLines in the four languages', () => {
    for (const lang of LANGS) {
        const t = tFor(lang);

        it(`${lang}: a cable at 1000 Hz and at 125 Hz: the numbers, no note`, () => {
            for (const kind of ['usb1000', 'usb125'] as const) {
                for (const where of ['screen', 'f3'] as const) {
                    const l = linkLines(stats(kind), t, where);
                    expect(l, `${kind} ${where}`).not.toBeNull();
                    expect(l!.note, `${kind} ${where}`).toBeNull();
                    expect(l!.line).not.toMatch(/\{\w+\}/);
                }
            }
        });

        it(`${lang}: Bluetooth at 90 Hz and 30 Hz: the note, with the measured interval and the longest gap`, () => {
            for (const kind of ['ble90', 'ble30'] as const) {
                const s = stats(kind);
                const l = linkLines(s, t, 'screen')!;
                expect(l.note, kind).not.toBeNull();
                expect(l.note!, kind).not.toMatch(/\{\w+\}/);
                expect(l.note!, kind).toContain(ms(s.meanMs));
                expect(l.note!, kind).toContain(ms(s.maxGapMs));
                expect(l.note!, kind).toMatch(/Bluetooth/);
                expect(l.line, kind).toContain(ms(s.jitterMs));
            }
        });

        it(`${lang}: a bursty link: its own note (not the slow one), with the gap between bunches`, () => {
            const s: LinkStats = { ...stats('bleBursty'), verdict: 'bursty' };
            const bursty = linkLines(s, t, 'f3')!;
            const slow = linkLines({ ...s, verdict: 'slow' }, t, 'f3')!;
            expect(bursty.note).not.toBeNull();
            expect(bursty.note).not.toBe(slow.note);
            expect(bursty.note!).toContain(ms(s.maxGapMs));
        });

        it(`${lang}: F3's line carries the rate, the Controls screen's does not (it has the rate on its own line)`, () => {
            const s = stats('ble90');
            expect(linkLines(s, t, 'f3')!.line).toContain(String(Math.round(s.hz)));
            expect(linkLines(s, t, 'screen')!.line).not.toContain(String(Math.round(s.hz)));
        });
    }

    it('control: a meter with too little to say, or a quiet device, says nothing', () => {
        const t = tFor('en');
        expect(linkLines(new LinkMeter().stats(0), t, 'screen')).toBeNull();
        const m = new LinkMeter();
        for (const x of reportTimes('ble90', 1000)) m.note(x);
        expect(linkLines(m.stats(1000), t, 'screen')).not.toBeNull();
        expect(linkLines(m.stats(1000 + 4000), t, 'screen')).toBeNull(); // the device went quiet
    });

    it('control: the languages differ (the note is not English in the others)', () => {
        const s = stats('ble90');
        const notes = LANGS.map((l) => linkLines(s, tFor(l), 'screen')!.note);
        expect(new Set(notes).size).toBe(4);
    });
});
