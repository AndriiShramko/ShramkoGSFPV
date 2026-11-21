// Lane course3, stage G1-progress: the progress line of the walls build and of the course generation (course/progress.ts),
// the estimates it says, its spoken pace, the ladder's report of the Gaussians of every step (bake.ts bakeBase onStep), the
// worker's announcement of every try (layTries) and the locale lines in all four languages. Fake clocks only.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    COURSE_TRY_MIN_MS, COURSE_TRY_MS_5CM, FREEZE_NOTE_S, PROGRESS_TICK_MS, mayFreeze, SPEAK_EVERY_MS, SPEAK_GAP_MS, ProgressClock, SpeechPacer, clock,
    courseSteps, courseTryMs, isParked, layTries, progressLine, roundLeft, spokenLine, wallsSteps, ANALYSE_MS, planStepMs, planSteps
} from '../../../apps/fly/src/course/progress';
import { fakeDocument } from './helpers/fake-dom';
import { courseOfLink } from '../../../apps/fly/src/course/link';
import { courseLinkId } from '@gsfpv/tracks';
import { BASE_VOXEL_M, LADDER_S_PER_MILLION, bakeBase } from '../../../apps/fly/src/bake';
import type { BakeResult, SceneSize } from '../../../apps/fly/src/bake';
import { S } from '@gsfpv/sim-core';

const LOC = join(__dirname, '..', '..', '..', 'packages', 'i18n', 'locales', 'fly', 'course');
const lines = (lang: string): Record<string, string> => JSON.parse(readFileSync(join(LOC, `${lang}.json`), 'utf8'));
const tOf = (dict: Record<string, string>) => (key: string, p: Record<string, string | number> = {}): string =>
    (dict[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => String(p[k] ?? `{${k}}`));
const EN = tOf(lines('en'));

/** a hand-moved clock */
function fakeNow(): { now: () => number; go: (ms: number) => void } {
    let t = 1000;
    return { now: () => t, go: (ms) => { t += ms; } };
}

describe('the walls build line', () => {
    // Wroclaw level 2 (walls-ladder.test.ts WROCLAW): 10.77 M Gaussians at 9.5 s per million = 102 s
    const steps = wallsSteps(10_770_000, LADDER_S_PER_MILLION);
    it('splits the measured total into size, read and voxelise', () => {
        expect(steps.map((s) => s.key)).toEqual(['size', 'read', 'voxelize']);
        const total = steps.reduce((a, s) => a + s.estMs, 0);
        expect(Math.abs(total - 1000 - 10.77 * 9.5 * 1000)).toBeLessThan(5);
        expect(steps[2].estMs).toBe(Math.round(10.77 * 2.74 * 1000));
    });
    it('says the step, n of m, a percent, the time so far and what is left; past the estimate it says so', () => {
        const c = fakeNow();
        const p = new ProgressClock('walls', steps, c.now);
        let v = p.view();
        expect([v.n, v.m, v.pct, v.elapsedS]).toEqual([1, 3, 0, 0]);
        expect(v.leftS).toBe(Math.ceil(steps.reduce((a, s) => a + s.estMs, 0) / 1000));
        c.go(800);
        p.enter('read');
        c.go(30_000);
        v = p.view();
        expect([v.key, v.n]).toEqual(['read', 2]);
        expect(v.elapsedS).toBe(30);
        expect(v.pct).toBeGreaterThan(20);
        expect(v.pct).toBeLessThan(40);
        const line = progressLine(v, EN);
        expect(line).toContain('Walls: reading the scan. Step 2 of 3');
        expect(line).toContain('0:30 so far');
        // left: the rest of the read (72.8 - 30 s) and the voxelising (29.5 s) = 72.3 s, said as 1:30
        expect(line).toContain('about 1:30 left');
        // the read runs past its estimate: no invented number, the honest line
        c.go(steps[1].estMs);
        v = p.view();
        expect(v.leftS).toBeNull();
        expect(progressLine(v, EN)).toContain('longer than usual, still working');
        // the percent never reaches 100 before the end
        expect(v.pct).toBeLessThanOrEqual(99);
    });
    it('a lighter way gets new estimates and its own name, the time so far goes on', () => {
        const c = fakeNow();
        const p = new ProgressClock('walls', steps, c.now);
        c.go(40_000);
        p.replan(wallsSteps(5_390_000, LADDER_S_PER_MILLION), 'wallsLighter');
        const v = p.view();
        expect(v.elapsedS).toBe(40);
        expect(progressLine(v, EN)).toContain('a lighter way');
    });
    it('the line is re-drawn often enough: never silent for more than two seconds', () => {
        expect(PROGRESS_TICK_MS).toBeLessThanOrEqual(2000);
    });
});

describe('the ladder tells the Gaussians of every step (bakeBase onStep)', () => {
    const WROCLAW = [43_090_000, 21_550_000, 10_770_000, 5_390_000, 2_690_000];
    const size: SceneSize = { kind: 'lod-meta', gaussians: WROCLAW[0], lodLevels: WROCLAW.length, from: 'tree', etag: null, byLevel: WROCLAW };
    it('one report per step, with its Gaussians, before the step runs', async () => {
        let n = 0;
        const bake = (async (_u: string, _k: string, _d: unknown, _s: unknown, o: { level?: number } = {}): Promise<BakeResult> => {
            n++;
            if (n === 1) throw new RangeError('Array buffer allocation failed');
            return { json: new Uint8Array(1), bin: new Uint8Array(1), gaussians: 1, solidVoxels: 1, voxelM: BASE_VOXEL_M, level: o.level ?? 0, ms: { read: 0, voxelize: 0, total: 0 }, peakJsHeapMb: null };
        }) as never;
        const seen: Array<[number, number]> = [];
        await bakeBase('u/lod-meta.json', 'lod-meta', null as never, () => undefined, { size, limits: { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 31 }, capGb: 2, bake, onStep: (s, i) => { seen.push([s.gaussians, i]); } } as never);
        expect(seen).toEqual([[10_770_000, 0], [5_390_000, 1]]);
    });
});

describe('the course line', () => {
    it('the expected try comes from the cell and the free space (course-rate.mjs)', () => {
        expect(courseTryMs(0.05, 24_757)).toBe(COURSE_TRY_MS_5CM);
        // F2 (after the sweep fix): 10 cm measured 2.4-4.9 s; 20 cm 0.54-1.38 s; Forest Floor 0.48 s (before F2)
        expect(courseTryMs(0.1, 33_234)).toBeGreaterThan(1000);
        expect(courseTryMs(0.1, 33_234)).toBeLessThan(5000);
        expect(courseTryMs(0.2, 24_071)).toBeGreaterThan(500);
        expect(courseTryMs(0.2, 24_071)).toBeLessThan(1400);
        // a 5 cm try is no longer the 38 s of before F2
        expect(COURSE_TRY_MS_5CM).toBeLessThan(10_000);
        expect(courseTryMs(0.05, 29)).toBe(COURSE_TRY_MIN_MS);
    });
    it('every try is announced: the first by the estimate, the next by what the last took', () => {
        const c = fakeNow();
        const posted: number[] = [];
        const make = layTries((ms) => posted.push(ms), 38_100, c.now, (k: number) => { c.go(1000 * k); return k; });
        expect(make(30)).toBe(30);
        make(5);
        expect(posted).toEqual([38_100, 30_000]);
    });
    it('free space, then the gates; a second try is named', () => {
        const c = fakeNow();
        const p = new ProgressClock('course', courseSteps(null), c.now);
        expect(progressLine(p.view(), EN)).toContain('Course: finding the free space. Step 1 of 2');
        c.go(900);
        p.enter('lay', 46_000);
        c.go(10_000);
        const v = p.view();
        expect(v.leftS).toBe(36);
        expect(progressLine(v, EN)).toContain('placing the gates and obstacles. Step 2 of 2');
        c.go(40_000);
        p.enter('lay', 46_000);
        expect(progressLine(p.view(), EN)).toContain('try 2');
    });
    it('the percent never goes back when a try starts again (G4: "try 3 ... 75 %, then try 4 ... 63 %")', () => {
        const c = fakeNow();
        const p = new ProgressClock('course', courseSteps(null), c.now);
        c.go(2400);
        p.enter('lay', 400);
        const seen: number[] = [];
        for (let k = 0; k < 4; k++) {
            c.go(300);
            seen.push(p.view().pct);
            // the next try is expected to take what this one took
            p.enter('lay', 300);
            seen.push(p.view().pct);
        }
        for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
        // and it still moves on: the later tries add to it
        expect(seen[seen.length - 1]!).toBeGreaterThan(seen[0]!);
    });
});

describe('spoken progress for Fly by Sound', () => {
    it('a new step is spoken at once, the same step again only after SPEAK_EVERY_MS', () => {
        const c = fakeNow();
        const p = new ProgressClock('course', courseSteps(5000), c.now);
        const s = new SpeechPacer(c.now);
        expect(s.due(p.view())).toBe(true);
        c.go(PROGRESS_TICK_MS);
        expect(s.due(p.view())).toBe(false);
        c.go(SPEAK_GAP_MS);
        p.enter('lay');
        expect(s.due(p.view())).toBe(true);
        c.go(SPEAK_EVERY_MS - 1);
        expect(s.due(p.view())).toBe(false);
        c.go(1);
        expect(s.due(p.view())).toBe(true);
    });
    it('the spoken line has no clock digits', () => {
        const c = fakeNow();
        const p = new ProgressClock('walls', wallsSteps(10_770_000, LADDER_S_PER_MILLION), c.now);
        expect(spokenLine(p.view(), EN)).toMatch(/^Walls: checking the scan size, step 1 of 3\. About 2 minutes left\.$/);
    });
});

describe('words', () => {
    it('CR-2: before the steps that hold the main thread the box says the picture may stop, and for how long', () => {
        expect(['size', 'read', 'voxelize', 'lighter', 'done'].filter(mayFreeze)).toEqual(['read', 'voxelize']);
        // the longest unchanged text of the Wroclaw build was 21.0 s (G4 build-look)
        expect(FREEZE_NOTE_S).toBeGreaterThanOrEqual(21);
        expect(EN('progress.mayStop', { s: FREEZE_NOTE_S })).toContain(`${FREEZE_NOTE_S} seconds`);
    });
    it('m:ss and the rounding of what is left', () => {
        expect(clock(75)).toBe('1:15');
        expect([roundLeft(1), roundLeft(36), roundLeft(61), roundLeft(91)]).toEqual([5, 40, 90, 120]);
    });
    it('every progress line exists in en, es, pl, ru with the same placeholders', () => {
        const en = lines('en');
        const keys = Object.keys(en).filter((k) => k.startsWith('progress.'));
        // 18 + gen4b B2's progress.step.analyse
        expect(keys.length).toBe(19);
        for (const lang of ['es', 'pl', 'ru']) {
            const d = lines(lang);
            for (const k of keys) {
                expect(d[k], `${lang} ${k}`).toBeTruthy();
                expect((d[k].match(/\{\w+\}/g) ?? []).sort(), `${lang} ${k}`).toEqual((en[k].match(/\{\w+\}/g) ?? []).sort());
            }
        }
    });
});

describe('a course that arrives in flight', () => {
    it('parked means held at the spawn', () => {
        const s = new Float64Array(64);
        s[S.hold] = 1;
        s[S.px] = 1; s[S.py] = 2; s[S.pz] = 3;
        expect(isParked(s, [1, 2, 3])).toBe(true);
        s[S.hold] = 0;
        expect(isParked(s, [1, 2, 3])).toBe(false);
        s[S.hold] = 1;
        s[S.px] = 1.5;
        expect(isParked(s, [1, 2, 3])).toBe(false);
    });
});

// Lane gen4b B2 (gen4 design G9 and the end of G3): the asked course's steps (analyse, free, lay), its box that stays until
// the answer, the no-room box with one press on, the start line. NEG: on the old tree the progress was a HUD note of 13 px
// flashed for 2 ticks (course.ts showProgress), with no step 'analyse', no box and no end at 100.
describe('gen4b B2: the course box', () => {
    /** progress-box.ts draws through ui/dom.ts, whose i18n.ts reads the page's path on load: a page for the import */
    const withPage = async <R>(go: (pb: typeof import('../../../apps/fly/src/course/progress-box'), doc: ReturnType<typeof fakeDocument>) => R): Promise<R> => {
        const g = globalThis as Record<string, unknown>;
        const keep = { document: g.document, location: g.location };
        const doc = fakeDocument();
        g.document = doc;
        g.location = { pathname: '/en/', search: '', href: 'http://localhost/en/' };
        try {
            return go(await import('../../../apps/fly/src/course/progress-box'), doc);
        } finally {
            Object.assign(g, keep);
        }
    };

    it('steps analyse, free, lay with the rates; the share never goes back and ends at 100 on the answer', () => {
        expect(planSteps(null).map((s) => s.key)).toEqual(['analyse', 'free', 'lay']);
        expect(planStepMs('analyse', 0, 0.1)).toBe(ANALYSE_MS);
        expect(planStepMs('free', 0, 0.1)).toBe(courseSteps(null)[0]!.estMs);
        expect(planStepMs('lay', 0, 0.05)).toBe(courseTryMs(0.05, 15_000));
        expect(planStepMs('lay', 1234.4, 0.05)).toBe(1234);
        const c = fakeNow();
        const p = new ProgressClock('course', planSteps(null), c.now);
        const seen: number[] = [];
        const tick = (ms: number): void => {
            c.go(ms);
            seen.push(p.view().pct);
        };
        p.enter('analyse', planStepMs('analyse', 0, 0.1));
        tick(2000);
        tick(4000); // past its estimate
        p.enter('free', planStepMs('free', 0, 0.1));
        tick(3000);
        p.enter('lay', 2000);
        tick(1500);
        p.enter('lay', 2000); // the second try
        tick(500);
        tick(9000);
        expect(p.view().key).toBe('lay');
        expect(p.view().attempt).toBe(2);
        for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
        expect(Math.max(...seen)).toBeLessThan(100);
        p.finish();
        c.go(1000);
        expect(p.view()).toMatchObject({ pct: 100, leftS: 0, n: 3, m: 3 });
    });

    it('the box stays through late ticks until the answer, says the step, the percent and the time left, and Cancel cancels', async () => {
        await withPage((pb, doc) => {
            const parent = doc.createElement('div') as unknown as HTMLElement;
            const q = (sel: string) => (parent as unknown as { querySelector: (s: string) => { textContent: string; click: () => void } | null }).querySelector(sel);
            let cancels = 0;
            const box = new pb.CourseBox(parent, { cancel: () => cancels++, grow: () => undefined });
            const c = fakeNow();
            const p = new ProgressClock('course', planSteps(null), c.now);
            p.enter('analyse', 3000);
            box.show(pb.progressBoxModel(p.view(), EN));
            const first = q('[data-testid=gen-progress]');
            expect(first).not.toBeNull();
            expect(q('.gen-step')!.textContent).toBe('finding the best scanned part. Step 1 of 3');
            // the whole plan's time left: 3 + 5.1 + 3.1 s, said by 5 s
            expect(q('.gen-left')!.textContent).toBe('About 0:15 left');
            // the old note hid itself 2 ticks after the last line: a worker silent for 10 s left the screen empty
            c.go(10 * PROGRESS_TICK_MS);
            box.show(pb.progressBoxModel(p.view(), EN));
            expect(q('[data-testid=gen-progress]')).toBe(first);
            expect(q('.gen-left')!.textContent).toBe('Taking longer than expected, 0:10 so far');
            expect(box.model()).toMatchObject({ kind: 'progress', pct: p.view().pct });
            q('[data-action=gen-progress-cancel]')!.click();
            expect(cancels).toBe(1);
            p.finish();
            box.show(pb.progressBoxModel(p.view(), EN));
            expect([q('.gen-pct')!.textContent, q('.gen-left')!.textContent]).toEqual(['100 %', 'Done']);
            box.close();
            expect([q('[data-testid=gen-progress]'), box.model()]).toEqual([null, null]);
        });
    });

    it('no room: a box with the larger size in one press, another layout when no size helps, a cross and Close', async () => {
        await withPage((pb, doc) => {
            const m = pb.noRoomModel(1, 4, EN);
            expect([m.text, m.action, m.to]).toEqual(['No gate your drone passes fits at Scene size x1.', 'Make the scene x4 and build', 4]);
            expect(pb.noRoomModel(4, null, EN)).toMatchObject({ action: 'Try another layout', to: null });
            expect(pb.noRoomModel(4, 2, EN).to).toBeNull();
            const parent = doc.createElement('div') as unknown as HTMLElement;
            const q = (sel: string) => (parent as unknown as { querySelector: (s: string) => { click: () => void } | null }).querySelector(sel);
            const grown: (number | null)[] = [];
            const box = new pb.CourseBox(parent, { cancel: () => undefined, grow: (to) => grown.push(to) });
            box.show(m);
            expect(q('button.panel-x')).not.toBeNull();
            q('[data-action=gen-noroom-grow]')!.click();
            expect([grown, box.model()]).toEqual([[4], null]);
            box.show(m);
            q('[data-action=gen-noroom-close]')!.click();
            expect([grown.length, box.model()]).toEqual([1, null]);
            expect(pb.startLine(45.4, 9, EN)).toBe('Gates: 9. The start gate is 45 m away: follow the arrow. Key Shift+T hides the course');
            expect(pb.startLine(0.5, 9, EN)).toContain('You are at the start gate');
            expect(pb.START_LINE_MS).toBeGreaterThanOrEqual(8000);
        });
    });

    it('a link names the asked course (g2) and an old link stays the old generator (g1)', () => {
        expect(courseOfLink('?course=g1.bnhwha')).toEqual({ kind: 'legacy', seed: parseInt('bnhwha', 36) });
        const r = { seed: 1234567, level: 'pro' as const, spread: 'wide' as const, anyQuality: false };
        expect(courseOfLink(`?x=1&course=${courseLinkId(r)}`)).toEqual({ kind: 'request', request: r });
        expect(courseOfLink('?course=g2.zz.bq')).toBeNull();
        expect(courseOfLink('?scene=abc')).toBeNull();
    });

    it('every new line is in all four languages', () => {
        const keys = Object.keys(lines('en')).filter((k) => k.startsWith('course.gen.') || k === 'progress.step.analyse');
        const en = lines('en');
        expect(keys.length).toBeGreaterThan(30);
        for (const lang of ['es', 'pl', 'ru']) {
            const d = lines(lang);
            for (const k of keys) {
                expect(d[k], `${lang} ${k}`).toBeTruthy();
                expect((d[k]!.match(/\{\w+\}/g) ?? []).sort(), `${lang} ${k}`).toEqual((en[k]!.match(/\{\w+\}/g) ?? []).sort());
            }
        }
    });
});
