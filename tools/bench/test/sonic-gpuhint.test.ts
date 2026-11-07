// The GPU hint's words and memory (v0.12 lane v12-flight step 11, docs/wip/v12-plan.md 2.12). The rule (when it is due) has its truth table in
// packages/render-pc/test/gpu-hint.test.ts, the page's part (the note, the copy button, the line a helper hears) its browser run in
// tools/bench/src/sonic-gpuhint-page.ts. Held here, with no page: the address of the browser's flag (Chrome, Edge, Opera have one, Firefox
// has none: then the Windows setting alone is named), that the note names BOTH ways to switch in all four languages (the Windows way as
// the path Settings, System, Display, Graphics, the browser, Options, High performance; the browser's way with its address), that the
// words are in the dictionary in every language and say Intel and the other card, and that the note is remembered once (a blocked
// storage never throws and only means it shows again).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLAG_FRAGMENT, flagsAddress, forgetGpuHint, gpuHintParts, gpuHintSeen, markGpuHintSeen } from '../../../apps/fly/src/sonic/gpu-hint';
import { hostLines } from '../../../apps/fly/src/sonic/host-lines';
import { REPO } from '../src/evidence';

const UA = {
    chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0',
    opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 OPR/120.0.0.0',
    firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0',
    safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
};

const LANGS = ['en', 'es', 'pl', 'ru'] as const;
const dict = (l: string): Record<string, string> => JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'gpuhint', `${l}.json`), 'utf8')) as Record<string, string>;
const lookup = (l: string) => (k: string): string => dict(l)[k] ?? k;

describe('the flag the hint names', () => {
    it('is chrome://flags/#force-high-performance-gpu in Chrome, edge:// in Edge, opera:// in Opera, and none in Firefox or Safari (controls)', () => {
        expect(FLAG_FRAGMENT).toBe('force-high-performance-gpu');
        expect(flagsAddress(UA.chrome)).toBe('chrome://flags/#force-high-performance-gpu');
        expect(flagsAddress(UA.edge)).toBe('edge://flags/#force-high-performance-gpu');
        expect(flagsAddress(UA.opera)).toBe('opera://flags/#force-high-performance-gpu');
        // the bench's headless Chrome says HeadlessChrome: the same address (it was missed once, the Copy button was not there)
        expect(flagsAddress(UA.chrome.replace('Chrome/', 'HeadlessChrome/'))).toBe('chrome://flags/#force-high-performance-gpu');
        expect(flagsAddress(UA.firefox)).toBeNull();
        expect(flagsAddress(UA.safari)).toBeNull();
        expect(flagsAddress('')).toBeNull();
    });
});

describe('the note names both ways to switch, in every language', () => {
    for (const l of LANGS) {
        it(`${l}: the lead says Intel and the other card; the browser's way comes with its address; Windows' way is the path to High performance`, () => {
            const d = dict(l);
            const p = gpuHintParts(UA.chrome, lookup(l));
            expect(p.text).toBe(d['gpuhint.text']);
            expect(p.text).toMatch(/Intel/);
            expect(p.text).toMatch(/NVIDIA/);
            expect(p.text).toMatch(/AMD/);
            expect(p.text).toMatch(/Chrome/);
            expect(p.address).toBe('chrome://flags/#force-high-performance-gpu');
            expect(p.fixFlag).toBe(d['gpuhint.fixFlag']);
            expect(p.fixFlag).toMatch(/Enabled/);
            // Windows Settings, System, Display, Graphics, the browser, Options, High performance: the words of Windows in that language
            const windows: Record<string, RegExp> = {
                en: /Settings, System, Display, Graphics.*Options, High performance/,
                es: /Configuraci\u00f3n, Sistema, Pantalla, Gr\u00e1ficos.*Opciones, Alto rendimiento/,
                pl: /Ustawienia, System, Ekran, Grafika.*Opcje, Wysoka wydajno\u015b\u0107/,
                ru: /\u041f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b, \u0421\u0438\u0441\u0442\u0435\u043c\u0430, \u0414\u0438\u0441\u043f\u043b\u0435\u0439, \u0413\u0440\u0430\u0444\u0438\u043a\u0430.*\u041f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b, \u0412\u044b\u0441\u043e\u043a\u0430\u044f \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c/
            };
            expect(p.fixWindows).toMatch(windows[l] as RegExp);
        });
    }

    it('without a flag in the browser the note names the Windows way alone (control: Chrome has both)', () => {
        const none = gpuHintParts(UA.firefox, lookup('en'));
        expect(none.address).toBeNull();
        expect(none.fixFlag).toBeNull();
        expect(none.fixWindows).toMatch(/High performance/);
        const both = gpuHintParts(UA.chrome, lookup('en'));
        expect(both.fixFlag).not.toBeNull();
        expect(both.address).not.toBeNull();
    });

    it('has every word in all four languages (the same keys, none empty), and the line a helper hears in Fly by Sound, which names the Windows way', () => {
        const keys = Object.keys(dict('en')).sort();
        expect(keys).toEqual(['gpuhint.copied', 'gpuhint.copy', 'gpuhint.copyFailed', 'gpuhint.fixFlag', 'gpuhint.fixWindows', 'gpuhint.ok', 'gpuhint.text']);
        for (const l of LANGS) {
            expect(Object.keys(dict(l)).sort(), l).toEqual(keys);
            for (const v of Object.values(dict(l))) expect(v.trim().length).toBeGreaterThan(2);
            const said = hostLines(l)['sonic.say.gpuHint'];
            expect(said, l).toBeTruthy();
            expect(said).toMatch(/Intel/);
        }
        expect(hostLines('en')['sonic.say.gpuHint']).toMatch(/Settings, System, Display, Graphics, choose the browser, Options, High performance/);
    });
});

describe('the note is remembered once', () => {
    const memory = (): { store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; data: Map<string, string> } => {
        const data = new Map<string, string>();
        return { data, store: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) } };
    };

    it('is not seen at first, is seen after it was shown, and forgotten on request', () => {
        const m = memory();
        expect(gpuHintSeen(m.store)).toBe(false);
        markGpuHintSeen(m.store);
        expect(gpuHintSeen(m.store)).toBe(true);
        expect([...m.data.keys()]).toEqual(['gsfpv.hint.gpu']);
        forgetGpuHint(m.store);
        expect(gpuHintSeen(m.store)).toBe(false);
    });

    it('a blocked storage never throws: the hint reads as not seen and shows again (control: a working one is seen)', () => {
        const blocked: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
            removeItem: () => { throw new Error('blocked'); }
        };
        expect(() => markGpuHintSeen(blocked)).not.toThrow();
        expect(gpuHintSeen(blocked)).toBe(false);
        expect(() => forgetGpuHint(blocked)).not.toThrow();
        expect(gpuHintSeen(null)).toBe(false);
        const m = memory();
        markGpuHintSeen(m.store);
        expect(gpuHintSeen(m.store)).toBe(true);
    });
});
