// The GPU hint's words, memory and plan (v0.12 lane v12-flight step 11, docs/wip/v12-plan.md 2.12; lane gpu-select, docs/wip/gpu-select.md).
// The rule (what the page draws on, and whether a hint is due) has its truth table in packages/render-pc/test/gpu-hint.test.ts, the page's
// part (the note, the line that stays, the copy button, the line a helper hears) its browser run in tools/bench/src/sonic-gpuhint-page.ts.
// Held here, with no page:
//   - the addresses: the browser's flag (Chrome, Edge, Opera have one, Firefox has none: then the Windows way alone is named), Windows'
//     own graphics page as a link (ms-settings:display-advancedgraphics), the browser's switch for graphics acceleration (the software note);
//   - that the note names BOTH ways to switch in all four languages (the browser's with its address, Windows' as the path Settings, System,
//     Display, Graphics and High performance), names the adapter, and that every word is in the dictionary in every language;
//   - the memory: "Do not show again" is remembered; the mark of v0.12 ("shown once") is NOT that (the control that fails on the old code);
//     a browser that ran on a faster card is remembered as such, which also ends "Do not show again"; the software note keeps a choice
//     of its own, which real graphics end; what was said aloud is remembered, so later visits get the short reminder;
//   - the plan: the note comes on every visit while due, not twice in one, never over a paused flight; after the faster card it is the
//     "back" note; the software note comes whatever was remembered about the switch; on a faster card nothing is shown and the fact
//     is remembered.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLAG_FRAGMENT, GPU_HINT_KEY, GPU_HINT_SAID_KEY, GPU_HINT_SOFT_KEY, WINDOWS_GRAPHICS_SETTINGS, accelerationAddress, flagsAddress, forgetGpuHint, gpuHintMemory, gpuHintParts, gpuHintSaid, gpuHintSeen, gpuSoftHintOff, markGpuHintSaid, markGpuHintSeen, markGpuSoftHintOff, noteFastGraphics, noteHardwareGraphics, planGpuHint, relaunchWord, spokenLineKey } from '../../../apps/fly/src/sonic/gpu-hint';
import type { GpuHintAsk } from '../../../apps/fly/src/sonic/gpu-hint';
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
const NAME = 'Intel(R) UHD Graphics';

describe('the addresses the hint names', () => {
    it('the flag is chrome://flags/#force-high-performance-gpu in Chrome, edge:// in Edge, opera:// in Opera, and none in Firefox or Safari (controls)', () => {
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

    it('Windows\' graphics page is the address Windows gives it, and the note carries it as a link on Windows only (control: not elsewhere)', () => {
        expect(WINDOWS_GRAPHICS_SETTINGS).toBe('ms-settings:display-advancedgraphics');
        expect(gpuHintParts(UA.chrome, lookup('en')).settingsUrl).toBe('ms-settings:display-advancedgraphics');
        expect(gpuHintParts(UA.firefox, lookup('en')).settingsUrl).toBe('ms-settings:display-advancedgraphics');
        expect(gpuHintParts(UA.chrome, lookup('en'), { windows: false }).settingsUrl).toBeNull();
        // the software note is not about Windows' choice of card: no link there
        expect(gpuHintParts(UA.chrome, lookup('en'), { note: 'software' }).settingsUrl).toBeNull();
    });

    it('the button of the flags page that restarts the browser: Relaunch in Chrome and Opera, Restart in Edge', () => {
        expect(relaunchWord(UA.chrome)).toBe('Relaunch');
        expect(relaunchWord(UA.opera)).toBe('Relaunch');
        expect(relaunchWord(UA.edge)).toBe('Restart');
    });

    it('the browser\'s own switch for graphics acceleration: Settings, System in Chrome, Edge and Opera; Settings, General in Firefox; unknown elsewhere', () => {
        expect(accelerationAddress(UA.chrome)).toBe('chrome://settings/system');
        expect(accelerationAddress(UA.edge)).toBe('edge://settings/system');
        expect(accelerationAddress(UA.opera)).toBe('opera://settings/system');
        expect(accelerationAddress(UA.firefox)).toBe('about:preferences#general');
        expect(accelerationAddress(UA.safari)).toBeNull();
    });
});

describe('the note names both ways to switch, in every language', () => {
    /** Windows' own words for the path and the choice, in that language. */
    const windows: Record<string, RegExp[]> = {
        en: [/Settings, System, Display, Graphics/, /High performance/],
        es: [/Configuraci\u00f3n, Sistema, Pantalla, Gr\u00e1ficos/, /Alto rendimiento/],
        pl: [/Ustawienia, System, Ekran, Grafika/, /Wysoka wydajno\u015b\u0107/],
        ru: [/\u041f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b, \u0421\u0438\u0441\u0442\u0435\u043c\u0430, \u0414\u0438\u0441\u043f\u043b\u0435\u0439, \u0413\u0440\u0430\u0444\u0438\u043a\u0430/, /\u0412\u044b\u0441\u043e\u043a\u0430\u044f \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c/]
    };
    for (const l of LANGS) {
        it(`${l}: the lead names the adapter and the other card; the browser's way comes with its address; Windows' way is its page and High performance`, () => {
            const d = dict(l);
            const p = gpuHintParts(UA.chrome, lookup(l), { name: NAME });
            expect(p.note).toBe('switch');
            expect(p.text).toBe((d['gpuhint.text'] as string).split('{name}').join(NAME));
            expect(p.text).toContain(NAME);
            expect(p.text).not.toContain('{name}');
            expect(p.text).toMatch(/NVIDIA/);
            expect(p.text).toMatch(/AMD/);
            expect(p.text).toMatch(/Windows/);
            expect(p.address).toBe('chrome://flags/#force-high-performance-gpu');
            // the words on the flag's page are English in every language of the browser: Enabled, and the button that restarts it,
            // which Chrome calls Relaunch and Edge calls Restart (read from both pages)
            expect(d['gpuhint.fixFlag']).toContain('{button}');
            expect(p.fixFlag).toBe((d['gpuhint.fixFlag'] as string).split('{button}').join('Relaunch'));
            expect(p.fixFlag).toMatch(/Enabled/);
            expect(p.fixFlag).not.toContain('{button}');
            expect(gpuHintParts(UA.edge, lookup(l), { name: NAME }).fixFlag).toBe((d['gpuhint.fixFlag'] as string).split('{button}').join('Restart'));
            for (const re of windows[l] as RegExp[]) expect(p.fixWindows).toMatch(re);
            expect(p.settingsUrl).toBe('ms-settings:display-advancedgraphics');
            expect(p.fixWindowsMore).toBeNull();
            // what it costs and how to undo it: the flag's own word for "off" (Disabled, read from the flags page), and Windows
            expect(p.cost).toBe(d['gpuhint.cost']);
            expect(p.cost).toMatch(/Disabled/);
            expect(p.cost).toMatch(/Windows/);
        });

        it(`${l}: after the browser fell back from the faster card the lead says so; the software note says the processor draws and gives the browser's switch and the driver`, () => {
            const d = dict(l);
            const back = gpuHintParts(UA.chrome, lookup(l), { note: 'back', name: NAME });
            expect(back.text).toBe((d['gpuhint.textBack'] as string).split('{name}').join(NAME));
            expect(back.text).not.toBe(gpuHintParts(UA.chrome, lookup(l), { name: NAME }).text);
            expect(back.address).toBe('chrome://flags/#force-high-performance-gpu');
            expect(back.cost).toBe(d['gpuhint.cost']);
            const soft = gpuHintParts(UA.edge, lookup(l), { note: 'software', name: 'SwiftShader' });
            expect(soft.note).toBe('software');
            expect(soft.text).toContain('SwiftShader');
            expect(soft.address).toBe('edge://settings/system');
            expect(soft.fixFlag).toBe(d['gpuhint.softFixBrowser']);
            expect(soft.fixWindows).toBe(d['gpuhint.softFixDriver']);
            expect(soft.fixWindowsMore).toBe(d['gpuhint.softFixDriverWindows']);
            expect(soft.fixWindowsMore).toMatch(/Intel/);
            expect(soft.fixWindowsMore).toMatch(/NVIDIA/);
            expect(soft.cost).toBeNull();
            // not on Windows: Device Manager is not named
            expect(gpuHintParts(UA.chrome, lookup(l), { note: 'software', windows: false }).fixWindowsMore).toBeNull();
        });
    }

    it('with no name for the adapter the bracket that held it goes too (no empty brackets, no raw placeholder)', () => {
        for (const l of LANGS) {
            for (const note of ['switch', 'back', 'software'] as const) {
                const text = gpuHintParts(UA.chrome, lookup(l), { note }).text;
                expect(text, `${l} ${note}`).not.toMatch(/\{name\}|\(\s*\)/);
                expect(text.length, `${l} ${note}`).toBeGreaterThan(40);
            }
        }
        // control: the dictionary lines do carry the name in a bracket
        expect(dict('en')['gpuhint.text']).toMatch(/\(\{name\}\)/);
        expect(dict('en')['gpuhint.softText']).toMatch(/\(\{name\}\)/);
    });

    it('without a flag in the browser the note names the Windows way alone (control: Chrome has both)', () => {
        const none = gpuHintParts(UA.firefox, lookup('en'));
        expect(none.address).toBeNull();
        expect(none.fixFlag).toBeNull();
        expect(none.fixWindows).toMatch(/High performance/);
        expect(none.settingsUrl).toBe('ms-settings:display-advancedgraphics');
        const both = gpuHintParts(UA.chrome, lookup('en'));
        expect(both.fixFlag).not.toBeNull();
        expect(both.address).not.toBeNull();
    });

    it('has every word in all four languages (the same keys, none empty, the same placeholders), and the two lines a helper hears in Fly by Sound', () => {
        const keys = Object.keys(dict('en')).sort();
        expect(keys).toEqual([
            'gpuhint.copied', 'gpuhint.copy', 'gpuhint.copyFailed', 'gpuhint.cost', 'gpuhint.fixFlag', 'gpuhint.fixWindows', 'gpuhint.how', 'gpuhint.howFix',
            'gpuhint.line', 'gpuhint.line.integrated', 'gpuhint.line.software', 'gpuhint.nameSimilar', 'gpuhint.never', 'gpuhint.ok', 'gpuhint.openSettings',
            'gpuhint.softFixBrowser', 'gpuhint.softFixDriver', 'gpuhint.softFixDriverWindows', 'gpuhint.softText', 'gpuhint.text', 'gpuhint.textBack',
            'gpuhint.unnamed', 'gpuhint.warn.back', 'gpuhint.warn.software', 'gpuhint.warn.switch'
        ]);
        for (const l of LANGS) {
            expect(Object.keys(dict(l)).sort(), l).toEqual(keys);
            for (const [k, v] of Object.entries(dict(l))) {
                expect(v.trim().length, `${l} ${k}`).toBeGreaterThan(2);
                expect((v.match(/\{\w+\}/g) ?? []).sort(), `${l} ${k}`).toEqual(((dict('en')[k] as string).match(/\{\w+\}/g) ?? []).sort());
            }
            // the line that stays names the adapter in every language
            for (const k of ['gpuhint.line', 'gpuhint.line.integrated', 'gpuhint.line.software']) expect(dict(l)[k], `${l} ${k}`).toContain('{name}');
            const said = hostLines(l)['sonic.say.gpuHint'];
            expect(said, l).toBeTruthy();
            // the chip is not named by its maker: the rule is due for AMD's integrated chips too
            expect(said).not.toMatch(/Intel/);
            expect(said).toMatch(/NVIDIA/);
            const soft = hostLines(l)['sonic.say.gpuSoftware'];
            expect(soft, l).toBeTruthy();
            expect(soft).toMatch(/Windows/);
            // the short reminders of later visits: shorter than the long lines, and they name the button that stops them
            for (const [long, short] of [['sonic.say.gpuHint', 'sonic.say.gpuHintAgain'], ['sonic.say.gpuSoftware', 'sonic.say.gpuSoftwareAgain']] as const) {
                const again = hostLines(l)[short];
                expect(again, `${l} ${short}`).toBeTruthy();
                expect((again as string).length, `${l} ${short}`).toBeLessThan((hostLines(l)[long] as string).length);
                expect(again, `${l} ${short}`).toContain(dict(l)['gpuhint.never']);
            }
        }
        expect(hostLines('en')['sonic.say.gpuHint']).toMatch(/integrated graphics chip.*Settings, System, Display, Graphics, choose the browser, then High performance, and restart the browser/);
        expect(hostLines('en')['sonic.say.gpuSoftware']).toMatch(/on the processor, not on a graphics card.*in Windows that is Device Manager/);
    });
});

const memory = (): { store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, store: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) } };
};

describe('what the browser remembers about the hint', () => {
    it('nothing at first; "Do not show again" is remembered under one key; forgotten on request', () => {
        const m = memory();
        expect(gpuHintSeen(m.store)).toBe(false);
        expect(gpuHintMemory(m.store)).toBeNull();
        markGpuHintSeen(m.store);
        expect(gpuHintSeen(m.store)).toBe(true);
        expect(gpuHintMemory(m.store)).toBe('off');
        expect(GPU_HINT_KEY).toBe('gsfpv.hint.gpu');
        expect([...m.data.keys()]).toEqual(['gsfpv.hint.gpu']);
        forgetGpuHint(m.store);
        expect(gpuHintSeen(m.store)).toBe(false);
        expect(gpuHintMemory(m.store)).toBeNull();
    });

    it('the mark of v0.12 ("shown once", the value 1) is not "Do not show again": such a browser is told again (the owner\'s laptop held exactly this mark)', () => {
        const m = memory();
        m.data.set('gsfpv.hint.gpu', '1');
        expect(gpuHintSeen(m.store)).toBe(false);
        expect(gpuHintMemory(m.store)).toBeNull();
        // and any other stray value reads as nothing
        m.data.set('gsfpv.hint.gpu', 'yes');
        expect(gpuHintSeen(m.store)).toBe(false);
    });

    it('a browser that drew on a faster card is remembered as such, and that ends "Do not show again" (a later fall back is said again)', () => {
        const m = memory();
        markGpuHintSeen(m.store);
        expect(gpuHintSeen(m.store)).toBe(true);
        noteFastGraphics(m.store);
        expect(gpuHintMemory(m.store)).toBe('fast');
        expect(gpuHintSeen(m.store)).toBe(false);
        // "Do not show again" after that is the pilot's later word, and it holds
        markGpuHintSeen(m.store);
        expect(gpuHintMemory(m.store)).toBe('off');
    });

    it('a blocked storage never throws: nothing is remembered and the hint shows again (control: a working one remembers)', () => {
        const blocked: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
            removeItem: () => { throw new Error('blocked'); }
        };
        expect(() => markGpuHintSeen(blocked)).not.toThrow();
        expect(() => noteFastGraphics(blocked)).not.toThrow();
        expect(gpuHintSeen(blocked)).toBe(false);
        expect(gpuHintMemory(blocked)).toBeNull();
        expect(() => forgetGpuHint(blocked)).not.toThrow();
        expect(gpuHintSeen(null)).toBe(false);
        expect(gpuHintMemory(null)).toBeNull();
        const m = memory();
        markGpuHintSeen(m.store);
        expect(gpuHintSeen(m.store)).toBe(true);
    });
});

describe('the plan: when the note comes by itself', () => {
    const DUE: GpuHintAsk = { hint: 'switch', reason: 'due', kind: 'integrated' };
    const SOFT: GpuHintAsk = { hint: 'software', reason: 'no-webgpu', kind: 'software' };
    const FAST: GpuHintAsk = { hint: null, reason: 'not-intel', kind: 'other' };
    const fresh = { shownThisVisit: false, paused: false };

    it('on every visit while the rule is due: a new visit shows it again, whatever number the visit is (the old code showed it once per browser)', () => {
        for (let visit = 0; visit < 5; visit++) expect(planGpuHint(DUE, null, fresh), `visit ${visit}`).toEqual({ note: 'switch', show: true, rememberFast: false, hardware: true });
    });

    it('not twice in one visit, and never over a paused flight; the note stays on demand (the line\'s button) either way', () => {
        expect(planGpuHint(DUE, null, { shownThisVisit: true, paused: false })).toEqual({ note: 'switch', show: false, rememberFast: false, hardware: true });
        expect(planGpuHint(DUE, null, { shownThisVisit: false, paused: true })).toEqual({ note: 'switch', show: false, rememberFast: false, hardware: true });
    });

    it('"Do not show again" keeps it away on later visits, but the line still has the note behind its button; the test hook can force it', () => {
        expect(planGpuHint(DUE, 'off', fresh)).toEqual({ note: 'switch', show: false, rememberFast: false, hardware: true });
        expect(planGpuHint(DUE, 'off', { ...fresh, force: true }).show).toBe(true);
        expect(planGpuHint(DUE, null, { shownThisVisit: true, paused: true, force: true }).show).toBe(true);
    });

    it('on a faster card nothing is shown and the fact is remembered; then the integrated chip again is a fall back, said as such', () => {
        expect(planGpuHint(FAST, null, fresh)).toEqual({ note: null, show: false, rememberFast: true, hardware: true });
        expect(planGpuHint(FAST, 'off', fresh)).toEqual({ note: null, show: false, rememberFast: true, hardware: true });
        expect(planGpuHint({ hint: null, reason: 'intel-discrete', kind: 'other' }, null, fresh).rememberFast).toBe(true);
        expect(planGpuHint(DUE, 'fast', fresh)).toEqual({ note: 'back', show: true, rememberFast: false, hardware: true });
        // the whole story of a laptop: due, "do not show again", switched (remembered), fallen back
        const m = memory();
        expect(planGpuHint(DUE, gpuHintMemory(m.store), fresh).show).toBe(true);
        markGpuHintSeen(m.store);
        expect(planGpuHint(DUE, gpuHintMemory(m.store), fresh).show).toBe(false);
        if (planGpuHint(FAST, gpuHintMemory(m.store), fresh).rememberFast) noteFastGraphics(m.store);
        expect(planGpuHint(DUE, gpuHintMemory(m.store), fresh)).toEqual({ note: 'back', show: true, rememberFast: false, hardware: true });
    });

    it('controls: a reading that is quiet for another reason remembers nothing (another system, a handheld, an unnamed adapter, an integrated chip without WebGPU)', () => {
        for (const r of [{ hint: null, reason: 'not-windows', kind: 'other' }, { hint: null, reason: 'handheld', kind: 'other' }, { hint: null, reason: 'unknown-adapter', kind: 'other' }, { hint: null, reason: 'no-webgpu', kind: 'integrated' }, { hint: null, reason: 'not-intel', kind: 'integrated' }] as GpuHintAsk[]) {
            expect(planGpuHint(r, 'off', fresh), r.reason).toEqual({ note: null, show: false, rememberFast: false, hardware: false });
        }
    });

    it('the software note comes once per visit whatever was remembered about the switch ("Do not show again" there was said about the other matter), until ITS OWN "Do not show again"', () => {
        expect(planGpuHint(SOFT, null, fresh)).toEqual({ note: 'software', show: true, rememberFast: false, hardware: false });
        expect(planGpuHint(SOFT, 'off', fresh)).toEqual({ note: 'software', show: true, rememberFast: false, hardware: false });
        expect(planGpuHint(SOFT, 'fast', fresh)).toEqual({ note: 'software', show: true, rememberFast: false, hardware: false });
        expect(planGpuHint(SOFT, null, { shownThisVisit: true, paused: false }).show).toBe(false);
        expect(planGpuHint(SOFT, null, { shownThisVisit: false, paused: true }).show).toBe(false);
        // its own choice silences it; the note stays behind the line's button, and the test hook can force it
        expect(planGpuHint(SOFT, null, { ...fresh, softOff: true })).toEqual({ note: 'software', show: false, rememberFast: false, hardware: false });
        expect(planGpuHint(SOFT, null, { ...fresh, softOff: true, force: true }).show).toBe(true);
        // control: that choice says nothing about the switch note
        expect(planGpuHint(DUE, null, { ...fresh, softOff: true }).show).toBe(true);
    });

    it('real graphics end the software note\'s choice: a due reading and a faster card say "hardware", a reading nothing is known about does not', () => {
        const m = memory();
        markGpuSoftHintOff(m.store);
        expect(gpuSoftHintOff(m.store)).toBe(true);
        // a reading nothing is known about: the choice stays
        if (planGpuHint({ hint: null, reason: 'unknown-adapter', kind: 'other' }, null, fresh).hardware) noteHardwareGraphics(m.store);
        expect(gpuSoftHintOff(m.store)).toBe(true);
        if (planGpuHint(SOFT, null, fresh).hardware) noteHardwareGraphics(m.store);
        expect(gpuSoftHintOff(m.store)).toBe(true);
        // the page on an integrated chip again: real graphics, the choice ends
        if (planGpuHint(DUE, null, fresh).hardware) noteHardwareGraphics(m.store);
        expect(gpuSoftHintOff(m.store)).toBe(false);
        expect([...m.data.keys()]).toEqual([]);
    });
});

describe('what is said aloud in Fly by Sound', () => {
    it('the long line the first time this browser has a note to say, the short reminder after that; a different note is new again', () => {
        expect(spokenLineKey('switch', null)).toBe('sonic.say.gpuHint');
        expect(spokenLineKey('switch', 'switch')).toBe('sonic.say.gpuHintAgain');
        expect(spokenLineKey('back', 'switch')).toBe('sonic.say.gpuHint');
        expect(spokenLineKey('back', 'back')).toBe('sonic.say.gpuHintAgain');
        expect(spokenLineKey('software', null)).toBe('sonic.say.gpuSoftware');
        expect(spokenLineKey('software', 'switch')).toBe('sonic.say.gpuSoftware');
        expect(spokenLineKey('software', 'software')).toBe('sonic.say.gpuSoftwareAgain');
        expect(spokenLineKey('switch', 'software')).toBe('sonic.say.gpuHint');
    });

    it('what was said is remembered under its own key; a faster card ends it (a later fall back is said in full); forgetting clears every key', () => {
        const m = memory();
        expect(gpuHintSaid(m.store)).toBeNull();
        markGpuHintSaid('switch', m.store);
        expect(gpuHintSaid(m.store)).toBe('switch');
        expect(m.data.get(GPU_HINT_SAID_KEY)).toBe('switch');
        expect(GPU_HINT_SAID_KEY).toBe('gsfpv.hint.gpu.said');
        expect(GPU_HINT_SOFT_KEY).toBe('gsfpv.hint.gpu.soft');
        // a stray value reads as nothing
        m.data.set(GPU_HINT_SAID_KEY, 'yes');
        expect(gpuHintSaid(m.store)).toBeNull();
        markGpuHintSaid('back', m.store);
        noteFastGraphics(m.store);
        expect(gpuHintSaid(m.store)).toBeNull();
        expect(gpuHintMemory(m.store)).toBe('fast');
        markGpuHintSaid('software', m.store);
        markGpuSoftHintOff(m.store);
        forgetGpuHint(m.store);
        expect([...m.data.keys()]).toEqual([]);
    });
});
