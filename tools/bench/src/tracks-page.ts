// The courses' page probe (train 1, lane tracks, T3; docs/wip/train1-plan.md section 3 bullet T3, docs/wip/tracks.md). A RELEASE build of
// this tree (dist/) under nginx's enforced CSP with a local API on a fresh DATA_DIR (tracks-serve.ts), headless Chrome (chrome.mjs through
// browser.ts), the keyboard, and one click on the pause menu's "Save for everyone".
//   A  scene 887f27aa at its own size (the fixture scene 39e63ce9 gives 0 gates, tracks.md Findings; 7a475d38 gives 24 only at the
//      free-garden lesson size, in the page at its own size it said 'nothing fits', run 1 of 2026-11-13): Shift+G generates (hook source
//      'generated', gates > 0, drawn > 0), pixels of the course's colours in a screenshot over the one before; Shift+T hides it (drawn 0,
//      the pixels gone); the pause menu's "Save for everyone" stores it (hook.saved).
//   B  a fresh profile on the same scene: the list has it (serverTracks > 0), Shift+T loads it (source 'server', the same track id).
// Controls that must fire:
//   C1 a fresh profile on another scene (39e63ce9): serverTracks 0, source 'none', the menu's "Load" disabled.
//   C2 A's course with one gate moved into a wall of the scene (check.ts nearestWall + withGateAt on the walls Node loads), POSTed straight to
//      the API (the server cannot see walls, it stores it); a fresh profile loads the newest with Shift+T: refused (problem 'refused...') or, with A's course still saved, skipped to it (TR-3); never shown.
//   C3 the same page with the course's root never attached to the scene (the release script patched in flight by a route): the hook still
//      says drawn > 0, the pixel check fails.
//   E  the editor (train 2, T3-editor-ui): a generated course, Shift+B, "Save for everyone" from the window, one gate moved, one added,
//      one deleted, "Save as my course" with a name (a fork: the row says created by and edited by), a vote up, a reload keeps the vote;
//      screenshots of the window at 1920x1080 and 844x390 (EDITOR_SHOTS). EDITOR_ONLY=1 runs E alone.
//   node scripts/build-release.mjs
//   cd tools/bench && npx tsx src/tracks-page.ts
// Holds C:/dev/.gpu-lock while the browser runs (one blocking loop, mkdir or 20 s more, at most 9 minutes; let go also on an error); the
// build and the servers run without it. Evidence: evidence/<date>/tracks-page.json (exit 1 when a check fails). Screenshots stay out of the
// repository (SHOTS, default the system's temp folder), their SHA-256 in the evidence.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { checkTrack, flownCollision, nearestWall, withGateAt } from '@gsfpv/tracks';
import type { TrackFile, Vec3 } from '../../../packages/sonic-fpv/src';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';
import { loadScene } from './scenes';
import { serveTracks } from './tracks-serve';

const SCENE = '887f27aa';
const OTHER = '39e63ce9';
const LOCK = 'C:/dev/.gpu-lock';
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'gsfpv-tracks-page', today());
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** pixels of the course's colours a drawn course must add over the screenshot before it (an estimate: a gate a few metres away covers thousands) */
const MIN_PX = 200;
/** colour distance per channel that still counts as the course's paint (an estimate: flat unlit colours, antialiased edges) */
const TOL = 24;
/** view.ts PAINT in 8-bit sRGB: next lime, later teal, arrows amber (passed grey is left out: the scan has grey everywhere) */
const PAINT: Record<string, [number, number, number]> = { next: [166, 255, 26], later: [38, 140, 140], arrow: [255, 184, 26] };

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): boolean => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 300)}`);
    return pass;
};
const shots: { file: string; sha256: string; what: string }[] = [];

let locked = false;
async function takeLock(): Promise<void> {
    const end = Date.now() + 9 * 60 * 1000;
    for (;;) {
        try {
            mkdirSync(LOCK);
            locked = true;
            return;
        } catch {
            if (Date.now() > end) throw new Error('the GPU lock was not free for 9 minutes');
            console.log('waiting for the GPU lock');
            await sleep(20000);
        }
    }
}
const letGo = (): void => {
    if (!locked) return;
    locked = false;
    try {
        rmdirSync(LOCK);
    } catch {
        /* gone */
    }
};
process.on('SIGINT', () => {
    letGo();
    process.exit(130);
});

interface CourseHook { on: boolean; source: string; track: { id: string; version: number } | null; gates: number; drawn: number; beaconPoints: number; problem: string | null; serverTracks: number; saved: string | null }
const course = (page: Page): Promise<CourseHook | null> =>
    page.evaluate(() => ((window as unknown as { __gsfpv?: { course?: CourseHook } }).__gsfpv?.course ?? null));
const status = (page: Page): Promise<string | null> => page.evaluate(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status ?? null);

/** Polls `get` until `ok`; the last value and whether it came in time (a miss is a failed check, never a throw). */
async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms: number): Promise<{ ok: boolean; v: T; ms: number }> {
    const t0 = Date.now();
    let v = await get();
    while (!ok(v) && Date.now() - t0 < ms) {
        await sleep(250);
        v = await get();
    }
    return { ok: ok(v), v, ms: Date.now() - t0 };
}

/** The page counting colours: about:blank of its own context (no CSP), a PNG decoded into a 2D canvas. */
let counter: Page;
async function colours(png: Buffer): Promise<Record<string, number>> {
    return counter.evaluate(
        async ({ b64, paint, tol }) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const g = c.getContext('2d') as CanvasRenderingContext2D;
            g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data;
            const out: Record<string, number> = {};
            for (const k of Object.keys(paint)) out[k] = 0;
            for (let i = 0; i < d.length; i += 4) {
                for (const [k, p] of Object.entries(paint)) {
                    if (Math.abs((d[i] as number) - p[0]) <= tol && Math.abs((d[i + 1] as number) - p[1]) <= tol && Math.abs((d[i + 2] as number) - p[2]) <= tol) {
                        out[k] = (out[k] as number) + 1;
                        break;
                    }
                }
            }
            return out;
        },
        { b64: png.toString('base64'), paint: PAINT, tol: TOL }
    );
}
const total = (c: Record<string, number>): number => Object.values(c).reduce((a, b) => a + b, 0);
/** pixels that differ by more than DIFF in a channel between two screenshots of the same view, and their mean colour in the first */
const DIFF = 40; // an estimate: above the frame-to-frame noise of a still view of the scan
async function difference(a: Buffer, b: Buffer): Promise<{ px: number; mean: number[] }> {
    return counter.evaluate(
        async ({ a64, b64, lim }) => {
            // no named function in here: tsx (esbuild keepNames) would wrap it in __name, which the page does not have
            const both: Uint8ClampedArray[] = [];
            for (const s of [a64, b64]) {
                const img = new Image();
                img.src = `data:image/png;base64,${s}`;
                await img.decode();
                const c = document.createElement('canvas');
                c.width = img.width;
                c.height = img.height;
                const g = c.getContext('2d') as CanvasRenderingContext2D;
                g.drawImage(img, 0, 0);
                both.push(g.getImageData(0, 0, c.width, c.height).data);
            }
            const x = both[0] as Uint8ClampedArray;
            const y = both[1] as Uint8ClampedArray;
            let px = 0;
            const sum = [0, 0, 0];
            for (let i = 0; i < x.length; i += 4) {
                if (Math.abs((x[i] as number) - (y[i] as number)) > lim || Math.abs((x[i + 1] as number) - (y[i + 1] as number)) > lim || Math.abs((x[i + 2] as number) - (y[i + 2] as number)) > lim) {
                    px++;
                    for (let k = 0; k < 3; k++) sum[k] = (sum[k] as number) + (x[i + k] as number);
                }
            }
            return { px, mean: sum.map((s) => (px ? Math.round(s / px) : 0)) };
        },
        { a64: a.toString('base64'), b64: b.toString('base64'), lim: DIFF }
    );
}
/** The course on, then off (Shift+T) in the same still view: what the course adds to the picture. */
async function onOff(page: Page, name: string): Promise<{ on: Record<string, number>; off: Record<string, number>; diff: { px: number; mean: number[] }; drawnOff: number | null }> {
    await sleep(1000);
    const a = await page.screenshot();
    await page.keyboard.press('Shift+KeyT');
    const hid = await until(() => course(page), (h) => h?.drawn === 0, 10000);
    await sleep(1000);
    const b = await page.screenshot();
    for (const [png, what] of [[a, 'on'], [b, 'off']] as const) {
        const file = join(SHOTS, `${name}-${what}.png`);
        writeFileSync(file, png);
        shots.push({ file, sha256: createHash('sha256').update(png).digest('hex'), what: `${name}: course ${what}` });
    }
    return { on: await colours(a), off: await colours(b), diff: await difference(a, b), drawnOff: hid.v?.drawn ?? null };
}
async function shot(page: Page, name: string, what: string): Promise<Record<string, number>> {
    const png = await page.screenshot();
    const file = join(SHOTS, `${name}.png`);
    writeFileSync(file, png);
    shots.push({ file, sha256: createHash('sha256').update(png).digest('hex'), what });
    return colours(png);
}

async function fresh(browser: Browser): Promise<BrowserContext> {
    return browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
}

/** A flight on `scene`: ready, then the Controls screen of a first flight (if it comes) answered with the keyboard. */
async function open(ctx: BrowserContext, site: string, scene: string, log: string[], lang = 'en'): Promise<Page> {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    await page.goto(`${site}/${lang}/fly/?scene=${scene}&nowarn=1`);
    await settle(page, scene);
    return page;
}

/** after a load or reload: ready, the Controls screen of a first flight (if it comes) answered with the keyboard */
async function settle(page: Page, scene: string): Promise<void> {
    const r = await until(() => status(page), (v) => v === 'ready' || v === 'error', 180000);
    if (r.v !== 'ready') throw new Error(`the flight on ${scene} is not ready: ${r.v}`);
    const radio = '.screen.radio [data-action="radio-keyboard"]';
    try {
        await page.waitForSelector(radio, { timeout: 15000 });
        await page.focus(radio);
        await page.keyboard.press('Enter');
        await until(() => page.evaluate(() => !document.querySelector('.screen.radio')), (v) => v, 10000);
    } catch {
        /* no Controls screen */
    }
    await sleep(1500);
}

// ---------------- E the editor (train 2, T3-editor-ui; tracks-plan 2.11)
interface EditorHook { open: boolean; selected: number; changed: boolean; problems: number; refused: string | null; said: string; votes: Record<string, number> }
const editorHook = (page: Page): Promise<EditorHook | null> =>
    page.evaluate(() => (window as unknown as { __gsfpv?: { course?: { editor?: EditorHook } } }).__gsfpv?.course?.editor ?? null);
const EDITOR_SHOTS = process.env.EDITOR_SHOTS ?? 'U:/Temp/gsfpv-train2/shots';
const EDITOR_SIZES = [
    { w: 1920, h: 1080, file: 'tracks-editor-1920.png' },
    { w: 844, h: 390, file: 'tracks-editor-844.png' }
];
/** the editor window's layout at the current size: inside the viewport (or scrolls), no two key buttons overlap */
const editorLayout = (page: Page): Promise<{ box: Box | null; scrolls: boolean; keys: number; keyOverlaps: number; smallestKeyFont: number }> =>
    page.evaluate(() => {
        // no named function in here: tsx (esbuild keepNames) would wrap it in __name, which the page does not have
        const w = document.querySelector('.course-editor') as HTMLElement | null;
        if (!w) return { box: null, scrolls: false, keys: 0, keyOverlaps: 0, smallestKeyFont: 0 };
        const r = w.getBoundingClientRect();
        const ks = Array.from(w.querySelectorAll('.ce-key')).map((k) => k.getBoundingClientRect());
        let overlaps = 0;
        for (let i = 0; i < ks.length; i++)
            for (let j = i + 1; j < ks.length; j++) {
                const a = ks[i]!;
                const b = ks[j]!;
                if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps++;
            }
        const fonts = Array.from(w.querySelectorAll('.ce-key kbd, .ce-key span')).map((k) => parseFloat(getComputedStyle(k).fontSize));
        return {
            box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
            scrolls: w.scrollHeight > w.clientHeight + 1 && getComputedStyle(w).overflowY !== 'visible',
            keys: ks.length,
            keyOverlaps: overlaps,
            smallestKeyFont: fonts.length ? Math.min(...fonts) : 0
        };
    });

/**
 * E: a generated course (link seed 1) in the editor (Shift+B): "Save for everyone" from the window, then one gate moved (ArrowUp), one
 * added (Insert), one deleted (Delete), a name typed and "Save as my course" (a fork of the saved one: created by the generator, edited
 * by the pilot), the fork's row in the list with both marks, a vote up on it; a reload, the editor again: the count and aria-pressed
 * kept. Screenshots of the open window at 1920x1080 and 844x390 (EDITOR_SHOTS).
 */
async function editorFlow(browser: Browser, site: string, log: string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    const ctx = await fresh(browser);
    try {
        const url = `${SCENE}&course=g1.1`;
        const p = await open(ctx, site, url, log);
        const g = await until(() => course(p), (h) => h?.source === 'generated' || !!h?.problem, 90000);
        check('E a generated course', g.v?.source === 'generated' && (g.v?.gates ?? 0) > 0, { source: g.v?.source, gates: g.v?.gates, problem: g.v?.problem });
        await p.keyboard.press('Shift+KeyB');
        const op = await until(() => editorHook(p), (e) => !!e?.open, 10000);
        const winUp = await p.isVisible('.course-editor');
        check('E Shift+B: the editor is open (hook and window)', !!op.v?.open && winUp, { hook: op.v, window: winUp });
        // stage F1-finish: no take-off prompt under the open editor (the HUD's gate line is empty while a panel pauses the flight)
        await sleep(400);
        const prompt = await p.evaluate(() => document.querySelector('.gate-msg')?.textContent ?? null);
        check('E no take-off prompt under the editor (.gate-msg empty)', prompt === '' || prompt === null, { prompt });
        // the selected gate is painted apart (one 'selected', the rest 'later' or red 'bad')
        const pa = (await editorHook(p))?.paints ?? [];
        check('E paint: exactly the selected gate is painted selected', pa.length > 0 && pa.filter((x) => x === 'selected' || x === 'selected-bad').length === 1 && (pa[op.v?.selected ?? 0] ?? '').startsWith('selected'), { paints: pa, selected: op.v?.selected });
        await until(() => p.evaluate(() => document.querySelectorAll('.course-editor .ce-row, .course-editor .ce-empty').length), (n) => n > 0, 10000);

        // "Save for everyone" from the window: the generated course becomes a server course (the fork's parent)
        const allOn = await p.isEnabled('.ce-save-all');
        await p.click('.ce-save-all');
        const sa = await until(() => course(p), (h) => !!h?.saved || !!h?.problem, 20000);
        const parent = sa.v?.saved ?? null;
        check('E Save for everyone (window): enabled, hook.saved is a server id', allOn && typeof parent === 'string' && parent.startsWith(`${SCENE}-`), { allOn, parent, problem: sa.v?.problem });
        const gates0 = (await course(p))?.gates ?? 0;

        // review TK-3: F6 enters the window (the name field), Tab then walks the window and does not select a gate; Esc in the
        // window gives the focus back and leaves the editor open
        const sel0 = (await editorHook(p))?.selected;
        await p.keyboard.press('F6');
        await sleep(100);
        const f6 = await p.evaluate(() => document.activeElement?.classList.contains('ce-name') || (document.activeElement as HTMLInputElement | null)?.type === 'text');
        await p.keyboard.press('Tab');
        await p.keyboard.press('Tab');
        await sleep(100);
        const walk = await p.evaluate(() => !!document.activeElement && !!document.querySelector('.course-editor')?.contains(document.activeElement));
        const selTab = (await editorHook(p))?.selected;
        await p.keyboard.press('Escape');
        await sleep(100);
        const back = await p.evaluate(() => !document.querySelector('.course-editor')?.contains(document.activeElement));
        const stillOpen = !!(await editorHook(p))?.open;
        check('E keyboard: F6 to the name field, Tab walks the window (gate kept), Esc gives focus back (editor open)', f6 && walk && selTab === sel0 && back && stillOpen, { f6, walk, sel0, selTab, back, stillOpen });

        // move one gate: ArrowUp (the first that is not refused; Tab to the next gate when a wall is in the way)
        const moves: unknown[] = [];
        let moved = false;
        for (let i = 0; i < 6 && !moved; i++) {
            await p.keyboard.press('ArrowUp');
            await sleep(200);
            const e = await editorHook(p);
            moves.push({ selected: e?.selected, changed: e?.changed, refused: e?.refused });
            moved = !!e?.changed && e.refused === null;
            if (!moved) {
                await p.keyboard.press('Tab');
                await sleep(100);
            }
        }
        check('E ArrowUp moves a gate (hook.changed, no refusal)', moved, moves);
        // add one: Insert (4 m ahead of the selected gate; Tab on when refused)
        let added = false;
        const adds: unknown[] = [];
        for (let i = 0; i < 6 && !added; i++) {
            await p.keyboard.press('Insert');
            await sleep(200);
            const h = await course(p);
            const e = await editorHook(p);
            adds.push({ gates: h?.gates, refused: e?.refused });
            added = h?.gates === gates0 + 1;
            if (!added) {
                await p.keyboard.press('Tab');
                await sleep(100);
            }
        }
        check(`E Insert adds a gate (${gates0} -> ${gates0 + 1})`, added, adds);
        // delete one: Delete
        let deleted = false;
        const dels: unknown[] = [];
        for (let i = 0; i < 6 && !deleted; i++) {
            await p.keyboard.press('Delete');
            await sleep(200);
            const h = await course(p);
            const e = await editorHook(p);
            dels.push({ gates: h?.gates, refused: e?.refused });
            deleted = h?.gates === gates0;
            if (!deleted) {
                await p.keyboard.press('Tab');
                await sleep(100);
            }
        }
        check(`E Delete removes a gate (back to ${gates0})`, deleted, dels);
        const ed1 = await editorHook(p);
        out.edits = { gates0, moves, adds, dels, problems: ed1?.problems, said: ed1?.said };

        // "Save as my course" with a name: a fork of the parent
        await p.fill('.ce-name', 'Probe Pilot');
        await p.click('.ce-save-mine');
        const sm = await until(() => course(p), (h) => (!!h?.saved && h.saved !== parent) || (h?.problem ?? '').startsWith('save'), 20000);
        const fork = sm.v?.saved ?? null;
        const ed2 = await editorHook(p);
        check('E Save as my course: a new server id (a fork), source server, unchanged after', typeof fork === 'string' && fork !== parent && sm.v?.source === 'server' && ed2?.changed === false, { fork, parent, source: sm.v?.source, problem: sm.v?.problem, said: ed2?.said });
        const rowSel = `.course-editor .ce-row[data-id="${fork}"]`;
        const row = await until(() => p.evaluate((s) => {
            const li = document.querySelector(s);
            return li ? { by: li.querySelector('.ce-by')?.textContent ?? null, edited: li.querySelector('.ce-edited')?.textContent ?? null } : null;
        }, rowSel), (v) => v !== null, 10000);
        // en words (locales/fly/course/en.json): "created by the generator", "edited by Probe Pilot (pilot)"; never "null" (run 1 of 2026-11-13 said "created by null (generator)")
        check('E the fork in the list: created by the generator, edited by the pilot', row.v?.by === 'created by the generator' && row.v?.edited === 'edited by Probe Pilot (pilot)', row.v);

        // tracks-plan 2.9: no vote before a lap on the course; a best lap of the fork in this browser (as a flown lap leaves it,
        // course/link.ts bestKey) and the window again: the row may vote
        const before = await p.evaluate((s) => ({ disabled: !!(document.querySelector(`${s} .ce-up`) as HTMLButtonElement | null)?.disabled, note: document.querySelector(`${s} .ce-lap`)?.textContent ?? null }), rowSel);
        check('E vote before a lap: the fork row\'s buttons disabled, "Fly a lap of this course to vote"', before.disabled && before.note === 'Fly a lap of this course to vote', before);
        await p.evaluate((id) => {
            const k = 'gsfpv.course.best';
            const all = JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, number>;
            all[`${id}.v1.887f27aa.0.-.-.probe`] = 30000;
            localStorage.setItem(k, JSON.stringify(all));
        }, fork);
        await p.keyboard.press('Escape');
        await until(() => editorHook(p), (e) => !e?.open, 5000);
        await p.keyboard.press('Shift+KeyB');
        await until(() => p.evaluate((s) => (document.querySelector(`${s} .ce-up`) as HTMLButtonElement | null)?.disabled === false, rowSel), (v) => v, 15000);
        // vote up on the fork
        await p.click(`${rowSel} .ce-up`);
        const vt = await until(() => editorHook(p), (e) => e?.votes?.[fork ?? ''] === 1, 10000);
        const up1 = await p.evaluate((s) => {
            const b = document.querySelector(`${s} .ce-up`);
            return b ? { text: b.textContent, pressed: b.getAttribute('aria-pressed') } : null;
        }, rowSel);
        check('E vote up: hook.votes = 1, "+ 1", aria-pressed true', vt.v?.votes?.[fork ?? ''] === 1 && up1?.text === '+ 1' && up1.pressed === 'true', { votes: vt.v?.votes, up: up1 });

        // screenshots of the open window
        const sizes: unknown[] = [];
        mkdirSync(EDITOR_SHOTS, { recursive: true });
        for (const s of EDITOR_SIZES) {
            await p.setViewportSize({ width: s.w, height: s.h });
            await sleep(1200);
            const lay = await editorLayout(p);
            const png = await p.screenshot();
            const file = join(EDITOR_SHOTS, s.file);
            writeFileSync(file, png);
            shots.push({ file, sha256: createHash('sha256').update(png).digest('hex'), what: `the editor at ${s.w}x${s.h}` });
            const inside = !!lay.box && lay.box.left >= 0 && lay.box.right <= s.w + 0.5 && lay.box.top >= 0 && (lay.box.bottom <= s.h + 0.5 || lay.scrolls);
            check(`E ${s.w}x${s.h}: the window inside the view (or scrolls), no two keys overlap`, inside && lay.keys > 0 && lay.keyOverlaps === 0, lay);
            // stage F1-finish: the HUD's top buttons are not under the window, the save buttons are in its visible part unscrolled
            const reach = await p.evaluate(() => {
                const w = document.querySelector('.course-editor') as HTMLElement | null;
                if (!w) return null;
                w.scrollTop = 0;
                const r = w.getBoundingClientRect();
                // inline (no named helper: tsx keepNames would wrap it in __name, which the page does not have)
                const tops = Array.from(document.querySelectorAll('#ui > .top-actions > *')).map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
                const saves = Array.from(w.querySelectorAll('.ce-save-mine, .ce-save-all')).map((e) => e.getBoundingClientRect());
                return {
                    topButtons: tops.length,
                    covered: tops.filter((b) => b.left < r.right && r.left < b.right && b.top < r.bottom && r.top < b.bottom).length,
                    saves: saves.length,
                    savesSeen: saves.filter((b) => b.top >= r.top - 0.5 && b.bottom <= Math.min(r.bottom, innerHeight) + 0.5).length
                };
            });
            check(`E ${s.w}x${s.h}: no top button under the window, both save buttons in view without scrolling`, !!reach && reach.topButtons > 0 && reach.covered === 0 && reach.saves === 2 && reach.savesSeen === 2, reach);
            sizes.push({ ...s, ...lay });
        }
        out.sizes = sizes;
        await p.setViewportSize({ width: 1280, height: 800 });

        // reload: the vote is kept
        await p.reload();
        await settle(p, url);
        await until(() => course(p), (h) => h?.source === 'generated' || !!h?.problem, 90000);
        await p.keyboard.press('Shift+KeyB');
        await until(() => editorHook(p), (e) => !!e?.open, 10000);
        const after = await until(() => p.evaluate((s) => {
            const b = document.querySelector(`${s} .ce-up`);
            return b ? { text: b.textContent, pressed: b.getAttribute('aria-pressed') } : null;
        }, rowSel), (v) => v !== null, 15000);
        check('E reload: the fork row shows "+ 1" and aria-pressed true', after.v?.text === '+ 1' && after.v?.pressed === 'true', after.v);
        out.fork = { id: fork, parent, row: row.v, vote: up1, afterReload: after.v };
    } finally {
        await ctx.close();
    }
    return out;
}

/** The TEST admin password and its hash (never the live one): this tree's .cache, else the lead copy's, read only; null when absent. */
function adminSecret(): { password: string; hash: string } | null {
    for (const f of [join(REPO, '.cache', 'admin-test.json'), 'C:/dev/gsfpv-v03/.cache/admin-test.json']) {
        if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as { password: string; hash: string };
    }
    return null;
}

/**
 * E3 (stage F1-finish, the admin's link and edit): signed in on the local copy's /admin/, the admin's "Open in the editor" link
 * course=<fork>.v1&edit=1 loads the served course and opens the editor (hook.track is the fork, the window up, the admin button
 * offered); one gate moved (ArrowUp, Tab on when refused) and "Save as the admin's version": version 2 on the server, written
 * under the admin's name, marked edited by the admin in the list.
 */
async function adminLinkFlow(browser: Browser, site: string, log: string[], fork: string | null, secret: { password: string } | null): Promise<Record<string, unknown>> {
    if (!fork || !secret) {
        check('E3 the admin link (needs the fork of E and .cache/admin-test.json)', false, { fork, secret: !!secret });
        return { skipped: true };
    }
    const ctx = await fresh(browser);
    try {
        const a = await ctx.newPage();
        await a.goto(`${site}/admin/`);
        await a.waitForSelector('[data-testid=password]', { timeout: 30000 });
        await a.fill('[data-testid=password]', secret.password);
        await a.press('[data-testid=password]', 'Enter');
        await a.waitForSelector('button[data-tab=tracks]', { timeout: 20000 });
        await a.close();
        const url = `${SCENE}&course=${fork}.v1&edit=1`;
        const p = await open(ctx, site, url, log);
        const op = await until(async () => ({ h: await course(p), e: await editorHook(p) }), (v) => (!!v.e?.open && v.h?.track?.id === fork) || !!v.h?.problem, 120000);
        const winUp = await p.isVisible('.course-editor');
        check('E3 the admin link course=<id>.v1&edit=1: the served course loaded, the editor open', !!op.v.e?.open && op.v.h?.track?.id === fork && op.v.h?.source === 'server' && winUp, { track: op.v.h?.track, source: op.v.h?.source, open: op.v.e?.open, problem: op.v.h?.problem, ms: op.ms });
        const adm = await until(() => p.evaluate(() => { const b = document.querySelector('.ce-save-admin') as HTMLButtonElement | null; return !!b && !b.hidden; }), (v) => v, 10000);
        check("E3 the admin's save button is offered (admin session)", adm.v, null);
        const moves: unknown[] = [];
        let moved = false;
        for (let i = 0; i < 6 && !moved; i++) {
            await p.keyboard.press('ArrowUp');
            await sleep(200);
            const e = await editorHook(p);
            moves.push({ selected: e?.selected, changed: e?.changed, refused: e?.refused });
            moved = !!e?.changed && e.refused === null;
            if (!moved) {
                await p.keyboard.press('Tab');
                await sleep(100);
            }
        }
        await p.click('.ce-save-admin');
        const sv = await until(() => course(p), (h) => (h?.track?.version ?? 0) >= 2 || (h?.problem ?? '').startsWith('admin'), 20000);
        const file = await (await fetch(`${site}/api/tracks/${fork}/v2`)).json().catch(() => null) as { author?: { name?: string }; id?: string } | null;
        const rowSel = `.course-editor .ce-row[data-id="${fork}"]`;
        const edited = await until(() => p.evaluate((s) => document.querySelector(`${s} .ce-edited`)?.textContent ?? null, rowSel), (v) => !!v && v.startsWith('edited by') && v.includes('admin'), 10000);
        check("E3 Save as the admin's version: version 2 on the server under the admin's name, the row says edited by the admin", moved && sv.v?.track?.version === 2 && file?.id === fork && file?.author?.name === 'Admin' && edited.ok, { moved, moves, track: sv.v?.track, problem: sv.v?.problem, author: file?.author, edited: edited.v });
        return { track: sv.v?.track, edited: edited.v, moves };
    } finally {
        await ctx.close();
    }
}

const RE_ATTACH =/(new \w+\(`course-stage`,this\.r\.app\);)this\.r\.app\.root\.addChild\(\w+\),/;

// ---------------- H hintClearOfTimer (lane look L2, finding TR-11): the course's two-line hint (the flash note, ui/hud.ts) and the
// lap block (course/hud.ts) never intersect, at three sizes and in every language (the probe measures all four and names the one
// with the tallest hint). Shift+G builds a new course: 'course.generating', then 'course.ready' (with Shift+T in all four) for 4 s.
const SIZES = [
    { w: 1920, h: 1080, phone: false },
    { w: 1366, h: 768, phone: false },
    { w: 844, h: 390, phone: true }
];
const LANGS = ['en', 'es', 'pl', 'ru'];
const LOOK_SHOTS = process.env.LOOK_SHOTS ?? SHOTS;
interface Box { left: number; top: number; right: number; bottom: number }
interface HintRead { note: Box | null; block: Box | null; text: string; vw: number; vh: number }
const readHint = (page: Page): Promise<HintRead> =>
    page.evaluate(() => {
        // no named function in here: tsx (esbuild keepNames) would wrap it in __name, which the page does not have
        const els = [document.querySelector<HTMLElement>('#ui > .hud-note'), document.querySelector<HTMLElement>('[data-testid="course-hud"]')];
        const [note, block] = els.map((el) => {
            if (!el || el.hidden || el.offsetParent === null) return null;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
        });
        return { note: note ?? null, block: block ?? null, text: els[0]?.textContent ?? '', vw: innerWidth, vh: innerHeight };
    });
const meets = (a: Box, b: Box): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

async function hintClearOfTimer(browser: Browser, site: string, log: string[]): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown>[] = [];
    const pics = new Map<string, Buffer>();
    for (const lang of LANGS) {
        for (const phone of [false, true]) {
            const sizes = SIZES.filter((s) => s.phone === phone);
            const first = sizes[0] as (typeof SIZES)[number];
            const ctx = await browser.newContext({ viewport: { width: first.w, height: first.h }, deviceScaleFactor: 1, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
            try {
                const page = await open(ctx, site, `${SCENE}&course=g1.1`, log, lang);
                await until(() => course(page), (h) => h?.source === 'generated' || !!h?.problem, 90000);
                for (const s of sizes) {
                    await page.setViewportSize({ width: s.w, height: s.h });
                    await sleep(800);
                    const before = (await course(page))?.track?.id ?? null;
                    await page.keyboard.press('Shift+KeyG');
                    const g = await until(() => course(page), (h) => (h?.source === 'generated' && h.track?.id !== before) || !!h?.problem, 90000);
                    // the hint is up for 4 s: two frames of layout (top-row.ts and course/hud.ts each lay out on the next frame), then read
                    const r = await until(() => readHint(page), (v) => !!v.note && /Shift\+T/.test(v.text) && !!v.block, 3000);
                    await sleep(400);
                    const v = await readHint(page);
                    const png = await page.screenshot();
                    // review LK-1: H off and on again (each flashes a note) must leave the lap block where it was
                    await page.keyboard.press('KeyH');
                    await sleep(400);
                    await page.keyboard.press('KeyH');
                    await sleep(400);
                    const hh = await readHint(page);
                    const hTop = hh.block ? +hh.block.top.toFixed(1) : null;
                    const hStill = !!v.block && hTop !== null && Math.abs(hTop - v.block.top) <= 1;
                    const clear = !!v.note && !!v.block && /Shift\+T/.test(v.text) && !meets(v.note, v.block) && v.block.bottom <= v.vh && hStill;
                    rows.push({ lang, size: `${s.w}x${s.h}`, phone, gen: g.ok, hintUp: r.ok, clear, hStill, topAfterHH: hTop, noteH: v.note ? Math.round(v.note.bottom - v.note.top) : null, ...v });
                    pics.set(`${lang}-${s.w}`, png);
                }
            } catch (err) {
                rows.push({ lang, phone, error: String(err).slice(0, 200) });
            } finally {
                await ctx.close();
            }
        }
    }
    // the language with the tallest hint (summed over the sizes) decides, its pictures go to the lead
    const tall = (lang: string): number => rows.filter((r) => r.lang === lang).reduce((a, r) => a + ((r.noteH as number | null) ?? 0), 0);
    const longest = [...LANGS].sort((a, b) => tall(b) - tall(a))[0] as string;
    mkdirSync(LOOK_SHOTS, { recursive: true });
    for (const s of SIZES) {
        const png = pics.get(`${longest}-${s.w}`);
        if (!png) continue;
        const file = join(LOOK_SHOTS, `look-course-${s.w}.png`);
        writeFileSync(file, png);
        shots.push({ file, sha256: createHash('sha256').update(png).digest('hex'), what: `hint and lap block, ${longest}, ${s.w}x${s.h}` });
    }
    const all = rows.length === LANGS.length * SIZES.length && rows.every((r) => r.clear === true);
    check(`hintClearOfTimer: the course hint and the lap block never meet (${SIZES.map((s) => `${s.w}x${s.h}`).join(', ')}; ${LANGS.join(', ')}; tallest hint ${longest})`, all, rows.map((r) => `${r.lang} ${r.size ?? ''} ${r.clear === true ? 'clear' : 'MEETS'} noteH ${r.noteH ?? '-'}${r.error ? ' ' + String(r.error) : ''}`));
    return { longest, rows };
}

async function main(): Promise<void> {
    // stage F1-finish: the API knows the TEST admin password (gitignored .cache/admin-test.json of this tree or the lead copy, read
    // only) so section E3 can sign in on the local copy; without the file E3 is skipped and says so
    const secret = adminSecret();
    const served = await serveTracks(join(REPO, 'dist'), secret ? {
        ADMIN_PASSWORD_HASH: secret.hash, TG_BOT_TOKEN: '', TG_CHAT_ID: '', TG_OWNER_BOT_TOKEN: '', TG_OWNER_CHAT_ID: '', TG_OWNER_USER_ID: '',
        TG_WEBHOOK_SECRET: '', TG_API_BASE: 'http://127.0.0.1:9', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', SMTP_HOST: '127.0.0.1', SMTP_PORT: '9'
    } : {});
    const out: Record<string, unknown> = { site: served.site, scene: SCENE, other: OTHER, minPx: MIN_PX, tol: TOL };
    const log: string[] = [];
    let browser: Browser | null = null;
    try {
        // C2's walls first (Node, no GPU): the cached scan's walls
        const walls0 = (await loadScene(SCENE)).collision;
        await takeLock();
        const launched = await launchChrome({ args: ['--window-size=1296,920'] });
        browser = launched.browser;
        out.browser = launched.which;
        counter = await (await browser.newContext()).newPage();

        // EDITOR_ONLY=1: the editor section alone (stage T3-editor-ui)
        if (process.env.EDITOR_ONLY === '1') {
            out.editor = await editorFlow(browser, served.site, log);
            out.adminLink = await adminLinkFlow(browser, served.site, log, (out.editor as { fork?: { id?: string | null } }).fork?.id ?? null, secret);
            throw new Error('EDITOR_ONLY');
        }
        out.hint = await hintClearOfTimer(browser, served.site, log);
        // HINT_ONLY=1: the hint check alone (its negative control on a build of origin/main)
        if (process.env.HINT_ONLY === '1') throw new Error('HINT_ONLY');

        // ---------------- A
        const ctxA = await fresh(browser);
        // the look: seed 1 by the course link (the generator's evidence seed), on then off in the same still view
        const a = await open(ctxA, served.site, `${SCENE}&course=g1.1`, log);
        const lk = await until(() => course(a), (h) => h?.source === 'generated' || !!h?.problem, 90000);
        const look = await onOff(a, 'a-seed1');
        // the paint, not the whole difference: hiding the course also hides the HUD's lap block (run 4: 16495 px changed with the root detached)
        check(`A look (link seed 1, ${lk.v?.gates} gates): >= ${MIN_PX} more pixels of the course's paint than with Shift+T`, (lk.v?.drawn ?? 0) > 0 && total(look.on) - total(look.off) >= MIN_PX, { drawn: lk.v?.drawn, ...look });
        check('A Shift+T: drawn 0', look.drawnOff === 0, look.drawnOff);
        const before = lk.v?.track?.id ?? null;
        await a.keyboard.press('Shift+KeyG');
        const gen = await until(() => course(a), (h) => (h?.source === 'generated' && h.track?.id !== before) || !!h?.problem, 90000);
        const hA = gen.v;
        check('A Shift+G: source generated', hA?.source === 'generated', { source: hA?.source, problem: hA?.problem, ms: gen.ms });
        check('A gates > 0', (hA?.gates ?? 0) > 0, hA?.gates);
        check('A drawn > 0', (hA?.drawn ?? 0) > 0, hA?.drawn);
        check('A beacon points > 0', (hA?.beaconPoints ?? 0) > 0, hA?.beaconPoints);
        const look2 = await onOff(a, 'a-random');
        await a.keyboard.press('Escape');
        await a.waitForSelector('.pause-menu', { timeout: 10000 });
        const saveBtn = '[data-action="pause.course.save"]';
        check('A menu: Save for everyone enabled', await a.isEnabled(saveBtn), null);
        await a.click(saveBtn);
        const sv = await until(() => course(a), (h) => !!h?.saved || !!h?.problem, 20000);
        const saved = sv.v?.saved ?? null;
        check('A saved: hook.saved is the server id', typeof saved === 'string' && saved.startsWith(`${SCENE}-`), { saved, problem: sv.v?.problem });
        out.a = { link: lk.v, look, generated: hA, lookRandom: look2, saved };
        await ctxA.close();

        // ---------------- B
        const ctxB = await fresh(browser);
        const b = await open(ctxB, served.site, SCENE, log);
        const lb = await until(() => course(b), (h) => (h?.serverTracks ?? -1) >= 0, 20000);
        check('B fresh profile: serverTracks > 0', (lb.v?.serverTracks ?? 0) > 0, lb.v?.serverTracks);
        await b.keyboard.press('Shift+KeyT');
        const ld = await until(() => course(b), (h) => h?.source === 'server' || !!h?.problem, 60000);
        check('B Shift+T: source server', ld.v?.source === 'server', { source: ld.v?.source, problem: ld.v?.problem, ms: ld.ms });
        check("B track id == A's saved id", !!saved && ld.v?.track?.id === saved, { b: ld.v?.track?.id, a: saved });
        check('B drawn > 0', (ld.v?.drawn ?? 0) > 0, ld.v?.drawn);
        out.b = ld.v;
        await ctxB.close();

        // ---------------- C1 another scene
        const ctxC = await fresh(browser);
        const c = await open(ctxC, served.site, OTHER, log);
        const lc = await until(() => course(c), (h) => (h?.serverTracks ?? -1) >= 0, 20000);
        check('C1 another scene: serverTracks 0', lc.v?.serverTracks === 0, lc.v?.serverTracks);
        check('C1 another scene: source none', lc.v?.source === 'none', lc.v?.source);
        await c.keyboard.press('Escape');
        await c.waitForSelector('.pause-menu', { timeout: 10000 });
        check('C1 menu: Load disabled', !(await c.isEnabled('[data-action="pause.course.load"]')), null);
        out.c1 = lc.v;
        await ctxC.close();

        // ---------------- C2 a gate in a wall
        let c2: Record<string, unknown> = {};
        if (saved) {
            const track = (await (await fetch(`${served.api}/api/tracks/${saved}/v1`)).json()) as TrackFile;
            const T = track.transform as [number, number, number, number];
            const walls = flownCollision(walls0, T);
            const k = Math.floor(track.gates.length / 2);
            const g = track.gates[k] as { pos: Vec3 };
            const centre: Vec3 = [g.pos[0] * T[0] + T[1], g.pos[1] * T[0] + T[2], g.pos[2] * T[0] + T[3]];
            const nw = nearestWall(walls, centre);
            if (nw) {
                // 0.2 m behind the wall's surface along the ray (an estimate: deeper than the 0.5 m margin needs, inside the wall)
                const into: Vec3 = [nw.point[0] + nw.dir[0] * 0.2, nw.point[1] + nw.dir[1] * 0.2, nw.point[2] + nw.dir[2] * 0.2];
                const bad = withGateAt(track, k, into, T);
                const nodeOk = checkTrack(track, walls, T, 0.5, false).ok;
                const nodeBad = checkTrack(bad, walls, T, 0.5, false);
                const r = await fetch(`${served.api}/api/tracks`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7' }, body: JSON.stringify(bad) });
                const posted = (await r.json()) as { id?: string };
                c2 = { gate: k, transform: T, centre, into, wallM: Math.round(nw.distance * 100) / 100, nodeOriginalOk: nodeOk, nodeMovedOk: nodeBad.ok, nodeIssues: nodeBad.issues.slice(0, 2), post: r.status, id: posted.id };
                check('C2 setup: Node proves the original, refuses the moved one; the server stores it (201)', nodeOk && !nodeBad.ok && r.status === 201, c2);
                const ctxD = await fresh(browser);
                const d = await open(ctxD, served.site, SCENE, log);
                const ldd = await until(() => course(d), (h) => (h?.serverTracks ?? -1) >= 0, 20000);
                await d.keyboard.press('Shift+KeyT');
                const rd = await until(() => course(d), (h) => h?.source === 'server' || !!h?.problem, 60000);
                // lane review TR-3 (after the probe was written): a refused newest row makes the page try the next saved row, so with
                // A's good course still on the server the page shows A's course and never the moved one; with no other row it fails 'refused'
                const loaded = rd.v?.track?.id ?? null;
                const refused = (rd.v?.problem ?? '').startsWith('refused') && rd.v?.source !== 'server';
                const skipped = rd.v?.source === 'server' && loaded === saved && (ldd.v?.serverTracks ?? 0) >= 2;
                check('C2 the moved course is refused in the page (refused, or skipped to the next saved row)', loaded !== posted.id && (refused || skipped), { serverTracks: ldd.v?.serverTracks, source: rd.v?.source, loaded, moved: posted.id, saved, problem: rd.v?.problem, refused, skipped });
                c2.page = rd.v;
                await ctxD.close();
            } else check('C2 setup: a wall near the gate', false, null);
        }
        out.c2 = c2;

        // ---------------- C3 the root never attached
        const ctxE = await fresh(browser);
        let patched = false;
        // any script of the page: since the integration the courses' feature is a chunk of its own (builtin/course-lazy.ts), not main-*.js
        await ctxE.route(/\/fly\/assets\/[^/]+\.js$/, async (route) => {
            const resp = await route.fetch();
            const body = await resp.text();
            const next = body.replace(RE_ATTACH, '$1void 0,');
            if (next !== body) patched = true;
            await route.fulfill({ response: resp, body: next });
        });
        const e = await open(ctxE, served.site, `${SCENE}&course=g1.1`, log);
        const ge = await until(() => course(e), (h) => h?.source === 'generated' || !!h?.problem, 90000);
        const lookE = await onOff(e, 'c3-seed1');
        check('C3 control: script patched, hook drawn > 0, the pixel check fails', patched && (ge.v?.drawn ?? 0) > 0 && total(lookE.on) - total(lookE.off) < MIN_PX, { patched, drawn: ge.v?.drawn, ...lookE });
        out.c3 = { patched, hook: ge.v, look: lookE };
        await ctxE.close();

        // ---------------- E the editor
        out.editor = await editorFlow(browser, served.site, log);
        out.adminLink = await adminLinkFlow(browser, served.site, log, (out.editor as { fork?: { id?: string | null } }).fork?.id ?? null, secret);
    } catch (err) {
        if (String(err) !== 'Error: HINT_ONLY' && String(err) !== 'Error: EDITOR_ONLY') check('the run finished', false, String(err).slice(0, 300));
    } finally {
        await browser?.close().catch(() => undefined);
        letGo();
        await served.stop();
    }
    out.log = log.slice(0, 20);
    const failed = checks.filter((c) => !c.pass).length;
    // EVIDENCE_NAME: e.g. train1c/tracks-page (a subfolder of evidence/<date>/)
    const name = process.env.EVIDENCE_NAME ?? 'tracks-page';
    mkdirSync(join(REPO, 'evidence', today(), name, '..'), { recursive: true });
    const file = writeEvidence(name, { step: 'tracks T3: the courses page probe', pass: failed === 0, checks, shots, ...out });
    console.log(`${checks.length - failed}/${checks.length} checks passed; evidence ${file}`);
    process.exit(failed === 0 ? 0 : 1);
}

void main();
