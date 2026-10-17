// The drawing policy (v0.7 lane R, rewritten for v0.9 items 7 and 13): stochastic drawing is the DEFAULT on a
// desktop WebGPU browser, and the answer comes from, in this order, the link, the pilot's settings (Render and
// Splat budget), the owner's scene entry, the device's default. Which devices get stochastic and a budget,
// that the choice reaches the engine's gsplat params, and the governor's top budget. Each part has a control
// that must fail: a policy that ignores the device, a policy with the old order (the setting beating the
// link, the device default sorted), one that lets the owner's entry beat the pilot, one that lets the pilot
// beat the link, an apply that ignores the renderer, a governor that is not told the top.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { resolveDrawing, isHandheld, isViewerMobile, applyDrawing, drawOnDevice, defaultBudgetM, canDrawStochastic, pilotBudgetM, DEFAULT_BUDGET_M, MOBILE_BUDGET_M, STOCHASTIC_BUDGET_M, BUDGET_OPTIONS, DRAWING_MODES, DRAWING_NOTES } from '../src/drawing';
import type { Drawing, DrawingAsk, DrawingDevice, DrawingRequest, PilotDrawing } from '../src/drawing';
import { FrameGovernor, DEFAULT_STEPS } from '../src/governor';
// the Display settings' definitions (packages/prefs is pure data; render-pc does not depend on it at run time)
import { DISPLAY_DEFS } from '../../prefs/src/defs/display';

const DESKTOP: DrawingDevice = { webgpu: true, handheld: false, mobile: false };
const DESKTOP_GL: DrawingDevice = { webgpu: false, handheld: false, mobile: false };
const PHONE: DrawingDevice = { webgpu: true, handheld: true, mobile: true };
/** iPadOS Safari: says "Macintosh", has touch points; a tablet to us (no stochastic), desktop to SuperSplat's viewer (4 M). */
const IPAD_OS: DrawingDevice = { webgpu: true, handheld: true, mobile: false };
const OWNER: DrawingRequest = { budgetM: 8, stochastic: true }; // superspl.at/scene/2f1ddf5f?budget=8&stochastic

const AUTO: PilotDrawing = { mode: 'auto' };
const ask = (o: { link?: DrawingRequest; pilot?: PilotDrawing; scene?: DrawingRequest }): DrawingAsk => ({ ...(o.link ? { link: o.link } : {}), pilot: o.pilot ?? AUTO, ...(o.scene ? { scene: o.scene } : {}) });

type Policy = (a: DrawingAsk, d: DrawingDevice) => Pick<Drawing, 'stochastic' | 'budgetM' | 'note'>;
interface Row { name: string; ask: DrawingAsk; device: DrawingDevice; want: Pick<Drawing, 'stochastic' | 'budgetM' | 'note'> }
const row = (name: string, a: DrawingAsk, device: DrawingDevice, stochastic: boolean, budgetM: number, note: Drawing['note'] = null): Row => ({ name, ask: a, device, want: { stochastic, budgetM, note } });

const ROWS: Row[] = [
    // ---- a desktop with WebGPU: stochastic is the default (v0.9, item 13)
    row('desktop: nobody asks -> stochastic, the measured default budget', ask({}), DESKTOP, true, STOCHASTIC_BUDGET_M),
    row('desktop: the owner\'s link', ask({ link: OWNER }), DESKTOP, true, 8),
    row('desktop: a link\'s budget alone keeps the default stochastic', ask({ link: { budgetM: 6 } }), DESKTOP, true, 6),
    row('desktop: a link asking sorted (stochastic=0) with its budget', ask({ link: { stochastic: false, budgetM: 2 } }), DESKTOP, false, 2),
    row('desktop: a link asking sorted gets the sorted default budget', ask({ link: { stochastic: false } }), DESKTOP, false, DEFAULT_BUDGET_M),
    row('desktop: the pilot chose sorted', ask({ pilot: { mode: 'sorted' } }), DESKTOP, false, DEFAULT_BUDGET_M),
    row('desktop: the pilot chose stochastic', ask({ pilot: { mode: 'stochastic' } }), DESKTOP, true, STOCHASTIC_BUDGET_M),
    // ---- the order: link > the pilot's settings > the owner's entry > the device
    row('link beats the pilot: sorted setting, stochastic link', ask({ link: OWNER, pilot: { mode: 'sorted' } }), DESKTOP, true, 8),
    row('link beats the pilot: stochastic setting, sorted link', ask({ link: { stochastic: false }, pilot: { mode: 'stochastic' } }), DESKTOP, false, DEFAULT_BUDGET_M),
    row('link beats the pilot\'s budget', ask({ link: { budgetM: 8 }, pilot: { mode: 'auto', budgetM: 16 } }), DESKTOP, true, 8),
    row('the pilot beats the owner\'s entry: sorted setting, stochastic entry', ask({ pilot: { mode: 'sorted' }, scene: { stochastic: true, budgetM: 6 } }), DESKTOP, false, 6),
    row('the pilot beats the owner\'s entry: stochastic setting, sorted entry', ask({ pilot: { mode: 'stochastic' }, scene: { stochastic: false } }), DESKTOP, true, STOCHASTIC_BUDGET_M),
    row('the pilot\'s budget beats the owner\'s entry', ask({ pilot: { mode: 'auto', budgetM: 16 }, scene: { budgetM: 6 } }), DESKTOP, true, 16),
    row('the owner\'s entry beats the device: a sorted scene', ask({ scene: { stochastic: false } }), DESKTOP, false, DEFAULT_BUDGET_M),
    row('the owner\'s entry beats the device: its own budget', ask({ scene: { stochastic: true, budgetM: 12 } }), DESKTOP, true, 12),
    row('a link field by field: the link\'s budget, the owner\'s stochastic', ask({ link: { budgetM: 3 }, scene: { stochastic: false } }), DESKTOP, false, 3),
    row('the pilot\'s budget alone, stochastic by default', ask({ pilot: { mode: 'auto', budgetM: 2 } }), DESKTOP, true, 2),
    // ---- phones and tablets: nothing of the request; the note says who asked and what was refused, none when nobody asked
    row('phone: nobody asks -> sorted, no note (the default is not news)', ask({}), PHONE, false, MOBILE_BUDGET_M),
    row('phone: the owner\'s link', ask({ link: OWNER }), PHONE, false, MOBILE_BUDGET_M, 'scene-handheld'),
    row('phone: the owner\'s entry asks stochastic', ask({ scene: OWNER }), PHONE, false, MOBILE_BUDGET_M, 'scene-handheld'),
    row('phone: the pilot chose stochastic', ask({ pilot: { mode: 'stochastic' } }), PHONE, false, MOBILE_BUDGET_M, 'setting-handheld'),
    row('phone: the pilot chose stochastic, the entry too -> the pilot\'s choice is named', ask({ pilot: { mode: 'stochastic' }, scene: OWNER }), PHONE, false, MOBILE_BUDGET_M, 'setting-handheld'),
    row('phone: a link\'s budget only', ask({ link: { budgetM: 8 } }), PHONE, false, MOBILE_BUDGET_M, 'budget-handheld'),
    row('phone: a link asking sorted with a big budget', ask({ link: { stochastic: false, budgetM: 1 } }), PHONE, false, MOBILE_BUDGET_M, 'budget-handheld'),
    row('phone: the pilot chose sorted, the owner\'s link asks stochastic', ask({ link: OWNER, pilot: { mode: 'sorted' } }), PHONE, false, MOBILE_BUDGET_M, 'scene-handheld'),
    row('phone: sorted chosen, the entry asks stochastic: nothing refused', ask({ pilot: { mode: 'sorted' }, scene: { stochastic: true } }), PHONE, false, MOBILE_BUDGET_M),
    row('phone: the phone\'s own budget is not refused', ask({ link: { budgetM: MOBILE_BUDGET_M } }), PHONE, false, MOBILE_BUDGET_M),
    row('phone: the desktop\'s 4 M asked by a link is a refusal (v0.8)', ask({ link: { budgetM: DEFAULT_BUDGET_M } }), PHONE, false, MOBILE_BUDGET_M, 'budget-handheld'),
    row('phone: the pilot\'s lighter budget is kept', ask({ pilot: { mode: 'auto', budgetM: 1 } }), PHONE, false, 1),
    row('phone: the pilot\'s heavier budget is refused, without a note (their own number)', ask({ pilot: { mode: 'auto', budgetM: 16 } }), PHONE, false, MOBILE_BUDGET_M),
    // review R5: an iPad whose Safari says "Macintosh" draws the 4 M superspl.at gives it; stochastic is still refused
    row('ipad: nobody asks', ask({}), IPAD_OS, false, DEFAULT_BUDGET_M),
    row('ipad: the owner\'s link', ask({ link: OWNER }), IPAD_OS, false, DEFAULT_BUDGET_M, 'scene-handheld'),
    row('ipad: a link\'s budget only', ask({ link: { budgetM: 8 } }), IPAD_OS, false, DEFAULT_BUDGET_M, 'budget-handheld'),
    row('ipad: the iPad\'s own budget is not refused', ask({ link: { budgetM: DEFAULT_BUDGET_M } }), IPAD_OS, false, DEFAULT_BUDGET_M),
    // WebGL (no WebGPU, or the engine fell back): the CPU-sort renderer cannot draw it
    row('webgl: nobody asks', ask({}), DESKTOP_GL, false, DEFAULT_BUDGET_M),
    row('webgl: the owner\'s link', ask({ link: OWNER }), DESKTOP_GL, false, DEFAULT_BUDGET_M, 'scene-webgl'),
    row('webgl: the pilot chose stochastic', ask({ pilot: { mode: 'stochastic' } }), DESKTOP_GL, false, DEFAULT_BUDGET_M, 'setting-webgl'),
    row('webgl: a link\'s budget only', ask({ link: { budgetM: 8 } }), DESKTOP_GL, false, DEFAULT_BUDGET_M, 'budget-webgl'),
    row('webgl: the pilot chose sorted, the link asks 8 M stochastic', ask({ link: OWNER, pilot: { mode: 'sorted' } }), DESKTOP_GL, false, DEFAULT_BUDGET_M, 'scene-webgl'),
    row('webgl: sorted asked by the entry', ask({ scene: { stochastic: false } }), DESKTOP_GL, false, DEFAULT_BUDGET_M),
    row('webgl: the pilot\'s lighter budget is kept', ask({ pilot: { mode: 'auto', budgetM: 2 } }), DESKTOP_GL, false, 2)
];

/** The rows a policy gets wrong. */
const failingRows = (policy: Policy) => ROWS.filter((r) => JSON.stringify(policy(r.ask, r.device)) !== JSON.stringify(r.want));
const failures = (policy: Policy): string[] => failingRows(policy).map((r) => r.name);
const real: Policy = (a, d) => { const { stochastic, budgetM, note } = resolveDrawing(a, d); return { stochastic, budgetM, note }; };

/** The v0.8 order, for the control: the setting beat the link, the device's default was sorted at 4 M. */
const v08: Policy = (a, d) => {
    const request = { budgetM: a.link?.budgetM ?? a.scene?.budgetM, stochastic: a.link?.stochastic ?? a.scene?.stochastic };
    const sceneAsks = a.pilot.mode === 'auto' && request.stochastic === true;
    const wants = a.pilot.mode === 'stochastic' || sceneAsks;
    if (d.webgpu && !d.handheld) return { stochastic: wants, budgetM: request.budgetM ?? DEFAULT_BUDGET_M, note: null };
    const top = defaultBudgetM(d);
    const who = a.pilot.mode === 'stochastic' ? 'setting' : sceneAsks ? 'scene' : request.budgetM !== undefined && request.budgetM !== top ? 'budget' : null;
    return { stochastic: false, budgetM: top, note: who ? `${who}-${d.handheld ? 'handheld' : 'webgl'}` as Drawing['note'] : null };
};

describe('resolveDrawing: link x pilot x owner\'s entry x device', () => {
    it('every row', () => {
        expect(failures(real)).toEqual([]);
        expect(DRAWING_MODES).toEqual(['auto', 'stochastic', 'sorted']);
    });

    it('the owner\'s example link on a desktop: stochastic at 8 M', () => {
        expect(resolveDrawing(ask({ link: OWNER }), DESKTOP)).toMatchObject({ stochastic: true, budgetM: 8, from: { stochastic: 'link', budget: 'link' } });
    });

    it('who decided each answer: the link, the setting, the entry, the device', () => {
        const from = (a: DrawingAsk, d = DESKTOP) => resolveDrawing(a, d).from;
        expect(from(ask({}))).toEqual({ stochastic: 'device', budget: 'device' });
        expect(from(ask({ link: OWNER, pilot: { mode: 'sorted', budgetM: 2 }, scene: { stochastic: false, budgetM: 1 } }))).toEqual({ stochastic: 'link', budget: 'link' });
        expect(from(ask({ pilot: { mode: 'sorted', budgetM: 2 }, scene: { stochastic: true, budgetM: 1 } }))).toEqual({ stochastic: 'setting', budget: 'setting' });
        expect(from(ask({ scene: { stochastic: false, budgetM: 1 } }))).toEqual({ stochastic: 'scene', budget: 'scene' });
        expect(from(ask({ link: { budgetM: 3 }, scene: { stochastic: false } }))).toEqual({ stochastic: 'scene', budget: 'link' });
        // a refusal is the device's; so is the budget of a request it refused
        expect(from(ask({ link: OWNER }), PHONE)).toEqual({ stochastic: 'device', budget: 'device' });
        expect(from(ask({ pilot: { mode: 'auto', budgetM: 1 } }), PHONE)).toEqual({ stochastic: 'device', budget: 'setting' });
    });

    it('control: the v0.8 order (the setting beats the link, sorted by default) fails the default, the precedence and the entry rows', () => {
        const f = failures(v08);
        // the device default, "link beats the pilot" both ways, the pilot-vs-entry and budget rows it ordered differently
        expect(f).toContain('desktop: nobody asks -> stochastic, the measured default budget');
        expect(f).toContain('link beats the pilot: sorted setting, stochastic link');
        expect(f).toContain('link beats the pilot: stochastic setting, sorted link');
        expect(f).toContain('the pilot\'s budget beats the owner\'s entry'); // it had no budget setting
        expect(f.length).toBeGreaterThanOrEqual(8);
        // and the rows the order did not touch (a phone given nothing, WebGL given nothing) pass either way
        expect(f).not.toContain('webgl: nobody asks');
    });

    it('control: a policy that lets the owner\'s entry beat the pilot fails exactly the pilot-vs-entry rows', () => {
        const entryFirst: Policy = (a, d) => real({ ...a, pilot: a.scene?.stochastic !== undefined ? { ...a.pilot, mode: 'auto' } : a.pilot }, d);
        const f = failures(entryFirst);
        expect(f).toContain('the pilot beats the owner\'s entry: sorted setting, stochastic entry');
        expect(f).toContain('the pilot beats the owner\'s entry: stochastic setting, sorted entry');
        expect(f).not.toContain('desktop: nobody asks -> stochastic, the measured default budget');
    });

    it('control: a policy that lets the pilot beat the link fails exactly the link-vs-pilot rows', () => {
        const pilotFirst: Policy = (a, d) => real(a.pilot.mode !== 'auto' ? { ...a, link: a.link ? { ...a.link, stochastic: undefined } : a.link } : a, d);
        const f = failures(pilotFirst);
        expect(f).toContain('link beats the pilot: sorted setting, stochastic link');
        expect(f).toContain('link beats the pilot: stochastic setting, sorted link');
        expect(f).not.toContain('desktop: the owner\'s link');
    });

    it('the Display settings Render and Splat budget: exactly these values, auto by default, live', () => {
        const d = DISPLAY_DEFS.find((x) => x.id === 'display.drawing');
        expect(d && d.type === 'enum' ? [...d.options] : null).toEqual([...DRAWING_MODES]);
        expect(d?.default).toBe('auto');
        expect(d?.apply).toBe('live');
        const b = DISPLAY_DEFS.find((x) => x.id === 'display.budget');
        expect(b && b.type === 'enum' ? [...b.options] : null).toEqual([...BUDGET_OPTIONS]);
        expect(b?.default).toBe('auto');
        expect(b?.apply).toBe('live');
    });

    it('pilotBudgetM: a number of millions from the control, undefined for auto and for anything else', () => {
        expect(BUDGET_OPTIONS.map((o) => pilotBudgetM(o))).toEqual([undefined, 1, 2, 4, 8, 16, 32]);
        for (const bad of [undefined, null, 8, '', '3', '0', '64', 'NaN', '8M', ' 8']) expect(pilotBudgetM(bad), String(bad)).toBeUndefined();
    });

    it('v0.8: a phone or tablet draws under SuperSplat\'s mobile budget (2 M), a desktop under its desktop budget (4 M)', () => {
        expect([MOBILE_BUDGET_M, DEFAULT_BUDGET_M]).toEqual([2, 4]);
        expect(defaultBudgetM(PHONE)).toBe(2);
        expect(defaultBudgetM(DESKTOP)).toBe(4);
        expect(defaultBudgetM(DESKTOP_GL)).toBe(4);
        expect(resolveDrawing(ask({}), PHONE).budgetM).toBe(2);
        // control: the v0.7 rule gave a phone the desktop's 4 M; it fails the phone rows (and the WebGL desktop's lighter pilot budget), never the iPad's
        const v07: Policy = (a, d) => ({ ...real(a, d), budgetM: d.webgpu && !d.handheld ? real(a, d).budgetM : DEFAULT_BUDGET_M });
        const f = failingRows(v07);
        expect(f.filter((r) => r.device.mobile).length).toBeGreaterThanOrEqual(8);
        expect(f.some((r) => r.device === IPAD_OS)).toBe(false);
    });

    it('review R5: the budget follows SuperSplat\'s viewer, so iPadOS (a tablet that says "Macintosh") draws 4 M; stochastic stays refused', () => {
        expect(defaultBudgetM(IPAD_OS)).toBe(DEFAULT_BUDGET_M);
        expect(resolveDrawing(ask({}), IPAD_OS)).toMatchObject({ stochastic: false, budgetM: DEFAULT_BUDGET_M, note: null });
        expect(resolveDrawing(ask({ pilot: { mode: 'stochastic' } }), IPAD_OS).stochastic).toBe(false);
        // control: the rule before R5 (the budget by isHandheld) gives the iPad 2 M and fails exactly the iPad rows
        const byHandheld: Policy = (a, d) => real(a, { ...d, mobile: d.handheld });
        const f = failingRows(byHandheld);
        expect(f.length).toBeGreaterThan(0);
        expect(f.every((r) => r.device === IPAD_OS)).toBe(true);
    });

    it('control: a policy that follows the asks on every device fails the phone and WebGL rows, and only those', () => {
        const blind: Policy = (a, d) => {
            const r = resolveDrawing(a, DESKTOP);
            void d;
            return { stochastic: r.stochastic, budgetM: r.budgetM, note: null };
        };
        const f = failingRows(blind);
        expect(f.length).toBeGreaterThanOrEqual(15);
        expect(f.every((r) => r.device.handheld || !r.device.webgpu)).toBe(true);
    });

    it('control: noting every request as "the scene asks" fails the setting rows, the budget-only rows and the default rows', () => {
        const old: Policy = (a, d) => {
            const x = real(a, d);
            if (d.webgpu && !d.handheld) return x;
            const asked = a.pilot.mode === 'stochastic' || a.link?.stochastic === true || a.scene?.stochastic === true || a.link?.budgetM !== undefined;
            return { ...x, note: asked ? (d.handheld ? 'scene-handheld' : 'scene-webgl') : null };
        };
        const wrong = failingRows(old);
        const notes = wrong.map((r) => r.want.note ?? 'none');
        expect(notes).toContain('setting-handheld');
        expect(notes).toContain('setting-webgl');
        expect(notes).toContain('budget-handheld');
        expect(notes).toContain('budget-webgl');
    });

    it('canDrawStochastic: a desktop browser whose renderer runs on WebGPU', () => {
        expect([canDrawStochastic(DESKTOP), canDrawStochastic(DESKTOP_GL), canDrawStochastic(PHONE), canDrawStochastic(IPAD_OS)]).toEqual([true, false, false, false]);
    });
});

describe('the HUD notes: a text for each in en, es, pl and ru', () => {
    const LANGS = ['en', 'es', 'pl', 'ru'];
    const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'i18n', 'locales', 'fly', 'drawing');
    const dict = (l: string) => JSON.parse(readFileSync(join(DIR, `${l}.json`), 'utf8')) as Record<string, string>;
    const missing = (notes: readonly string[]) => LANGS.flatMap((l) => notes.filter((n) => typeof dict(l)[`drawing.note.${n}`] !== 'string').map((n) => `${l} ${n}`));

    it('every note the policy gives, no text for a note that does not exist, numbers only in the budget notes', () => {
        expect(missing(DRAWING_NOTES)).toEqual([]);
        expect([...new Set(ROWS.map((r) => r.want.note).filter((n) => n !== null))].sort()).toEqual([...DRAWING_NOTES].sort());
        for (const l of LANGS) {
            const keys = Object.keys(dict(l)).filter((k) => k.startsWith('drawing.note.')).map((k) => k.slice('drawing.note.'.length));
            expect(keys.sort()).toEqual([...DRAWING_NOTES].sort());
            for (const n of DRAWING_NOTES) {
                const s = dict(l)[`drawing.note.${n}`];
                expect([s.includes('{budget}'), s.includes('{top}')]).toEqual(n.startsWith('budget-') ? [true, true] : [false, false]);
            }
        }
    });

    it('control: a note without texts is reported in every language', () => {
        expect(missing(['scene-vr'])).toEqual(['en scene-vr', 'es scene-vr', 'pl scene-vr', 'ru scene-vr']);
    });

    it('the settings and the F3 line have a text in every language (the same keys, placeholders kept)', () => {
        const keys = ['set.display.drawing', 'set.display.drawing.help', 'set.display.budget', 'set.display.budget.help', ...DRAWING_MODES.map((m) => `set.display.drawing.opt.${m}`), ...BUDGET_OPTIONS.map((o) => `set.display.budget.opt.${o}`), 'drawing.on', 'drawing.line', 'drawing.mode.stochastic', 'drawing.mode.sorted', 'drawing.from.link', 'drawing.from.setting', 'drawing.from.scene', 'drawing.from.device'];
        for (const l of LANGS) for (const k of keys) expect(typeof dict(l)[k], `${l} ${k}`).toBe('string');
        for (const l of LANGS) {
            expect(dict(l)['drawing.line'], l).toMatch(/\{mode\}.*\{modeFrom\}.*\{budget\}.*\{budgetFrom\}/);
            expect(dict(l)['drawing.on'], l).toContain('{budget}');
        }
    });
});

describe('isHandheld: phones and tablets, from the user agent', () => {
    const UA = {
        androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
        androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        cros: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    };

    it('handheld', () => {
        expect(isHandheld(UA.androidPhone, 5)).toBe(true);
        expect(isHandheld(UA.androidTablet, 10)).toBe(true);
        expect(isHandheld(UA.iphone, 5)).toBe(true);
        expect(isHandheld(UA.ipadOS, 5)).toBe(true); // iPadOS Safari says Macintosh, but has touch points
        expect(isHandheld(UA.windows, 0, true)).toBe(true); // Client Hints win
    });

    it('desktop, a touch-screen Windows laptop included', () => {
        expect(isHandheld(UA.ipadOS, 0)).toBe(false); // a real Mac
        expect(isHandheld(UA.windows, 0)).toBe(false);
        expect(isHandheld(UA.windows, 10)).toBe(false);
        expect(isHandheld(UA.linux, 0)).toBe(false);
        expect(isHandheld(UA.cros, 0)).toBe(false);
        expect(isHandheld(UA.windows, 0, false)).toBe(false);
    });

    it('control: touch points alone would make the Windows laptop a tablet', () => {
        const byTouch = (_ua: string, tp: number) => tp > 0;
        expect(byTouch(UA.windows, 10)).not.toBe(isHandheld(UA.windows, 10));
    });

    it('review R5: isViewerMobile is SuperSplat\'s viewer\'s rule (PlayCanvas platform.mobile) on every user agent', () => {
        // the engine's own rule, read from the playcanvas build this repo ships (platform.js): mobile is
        // platformName android or ios, decided from the user agent in this order
        const build = readFileSync(createRequire(import.meta.url).resolve('playcanvas'), 'utf8');
        const rule = build.match(/platformName = (\/android\/i)\.test\(ua\) \? "android" : (\/ip\(\?:\[ao\]d\|hone\)\/i)\.test\(ua\) \? "ios"/);
        expect(rule, 'the engine\'s platform rule moved: re-read playcanvas platform.js').not.toBeNull();
        const engineMobile = (ua: string) => /android/i.test(ua) || /ip(?:[ao]d|hone)/i.test(ua);
        for (const ua of Object.values(UA)) expect(isViewerMobile(ua), ua).toBe(engineMobile(ua));
        expect(isViewerMobile(UA.ipadOS)).toBe(false); // the viewer gives an iPadOS Safari the desktop budget
        expect(isViewerMobile(UA.androidTablet)).toBe(true);
        // control: isHandheld differs from the viewer exactly on iPadOS
        expect(Object.values(UA).filter((ua) => isHandheld(ua, 5) !== isViewerMobile(ua))).toEqual([UA.ipadOS]);
    });
});

describe('applyDrawing: the choice reaches the engine\'s gsplat params', () => {
    it('GPU sort (WebGPU): stochastic on and off', () => {
        const g = { stochastic: false, splatBudget: 4_000_000 };
        expect(applyDrawing(g, true, true)).toBe(true);
        expect(g.stochastic).toBe(true);
        expect(applyDrawing(g, false, true)).toBe(false);
        expect(g.stochastic).toBe(false);
        expect(g.splatBudget).toBe(4_000_000); // nothing else is touched
    });

    it('CPU sort (WebGL): never on, and switched off if it was', () => {
        const g = { stochastic: true };
        expect(applyDrawing(g, true, false)).toBe(false);
        expect(g.stochastic).toBe(false);
    });

    it('control: writing the wish without the renderer check leaves a WebGL page claiming stochastic', () => {
        const g = { stochastic: false };
        const naive = (p: { stochastic: boolean }, on: boolean) => { p.stochastic = on; return on; };
        naive(g, true);
        expect(g.stochastic).not.toBe(applyDrawing({ stochastic: false }, true, false));
    });
});

describe('drawOnDevice: a scan\'s drawing is decided with the device the renderer really got', () => {
    /** A renderer as the session sees it: its device, its budget, and stochastic only on WebGPU (as applyDrawing). */
    const renderer = (webgpu: boolean) => {
        const r = { isWebGPU: webgpu, budgetM: DEFAULT_BUDGET_M, stochastic: false, asked: [] as boolean[],
            setSplatBudgetMillions(m: number) { r.budgetM = m; },
            setStochastic(on: boolean) { r.stochastic = on && webgpu; return r.stochastic; } };
        return r;
    };
    const owner = (r: { asked: boolean[] }) => (webgpu: boolean) => { r.asked.push(webgpu); return resolveDrawing(ask({ link: OWNER }), { webgpu, handheld: false, mobile: false }); };

    it('WebGPU: the link\'s budget and stochastic before the scan loads', () => {
        const r = renderer(true);
        expect(drawOnDevice(r, owner(r))).toMatchObject({ stochastic: true, budgetM: 8, note: null });
        expect([r.budgetM, r.stochastic, r.asked]).toEqual([8, true, [true]]);
    });

    it('a browser that offers WebGPU but whose engine fell back to WebGL: the default budget, sorted', () => {
        const r = renderer(false);
        drawOnDevice(r, owner(r));
        expect([r.budgetM, r.stochastic, r.asked]).toEqual([DEFAULT_BUDGET_M, false, [false]]);
    });

    it('control: deciding with the browser\'s navigator.gpu before the device exists streams the WebGL fallback at the link\'s 8 M', () => {
        const r = renderer(false);
        const guess = resolveDrawing(ask({ link: OWNER }), { webgpu: true, handheld: false, mobile: false }); // what fly() did before
        r.setSplatBudgetMillions(guess.budgetM);
        r.setStochastic(guess.stochastic);
        expect(r.budgetM).toBe(8);
        expect(r.stochastic).toBe(false); // stochastic itself was always kept off by the renderer
    });
});

describe('the governor\'s top budget (a link\'s ?budget=)', () => {
    it('the default top is the old steps exactly', () => {
        const g = new FrameGovernor();
        expect(g.steps).toEqual(DEFAULT_STEPS);
        expect(g.topBudgetMillions).toBe(DEFAULT_BUDGET_M);
        expect(g.setTopBudget(DEFAULT_BUDGET_M)).toBe(false);
    });

    it('8 M: every step scales, the render scales and the step stay', () => {
        const g = new FrameGovernor();
        g.step = 2;
        expect(g.setTopBudget(8)).toBe(true);
        expect(g.steps.map((s) => s.splatBudgetMillions)).toEqual([8, 6, 5, 4, 3]);
        expect(g.steps.map((s) => s.renderScale)).toEqual(DEFAULT_STEPS.map((s) => s.renderScale));
        expect(g.step).toBe(2);
        expect(g.current.splatBudgetMillions).toBe(5);
        // back to the default top: the old numbers again, not a compounding scale
        g.setTopBudget(4);
        expect(g.steps).toEqual(DEFAULT_STEPS);
    });

    it('missed frames lower the budget from the new top', () => {
        const g = new FrameGovernor();
        g.setTopBudget(8);
        const p = 1000 / 60;
        let t = 0, k = 0;
        g.onFrame(t);
        while (t < 3000) { t += p * (k++ % 2 ? 2 : 1); g.onFrame(t); }
        expect(g.step).toBeGreaterThan(0);
        expect(g.current.splatBudgetMillions).toBeLessThan(8);
        expect(g.current.splatBudgetMillions).toBeGreaterThan(DEFAULT_STEPS[g.step].splatBudgetMillions);
    });

    it('control: without setTopBudget the governor never gives more than 4 M', () => {
        const g = new FrameGovernor();
        expect(Math.max(...g.steps.map((s) => s.splatBudgetMillions))).toBe(4);
        expect(() => g.setTopBudget(0)).toThrow(RangeError);
        expect(() => g.setTopBudget(Number.NaN)).toThrow(RangeError);
    });
});
