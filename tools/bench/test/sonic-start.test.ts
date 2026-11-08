// v0.12 Fly by Sound, lane v12-flight step 8 (docs/wip/v12-plan.md 4.2): what the start screen shows, as data
// (apps/fly/src/sonic/start-model.ts), and the entry's small parts that need no page.
//  - every shipped lesson is on the screen exactly once, grouped by module in the ladder's order, whatever the path (the
//    ladder is a recommendation, not a gate); only the module-7 lesson flies a scan;
//  - where the pilot stands is shown in each lesson (passed, in progress, new), Continue opens the lesson left off on (or
//    the first of the path not passed), nothing is offered to continue before a lesson was begun, Start opens the path's
//    first lesson;
//  - ?sonic= is the start screen, a shipped lesson, or an unknown word (the start screen with a note), never a crash;
//  - the world a lesson flies in exists for every lesson but the scan one (the ears lessons get a floor), and its scene id
//    is a lesson id that can never be a hex SuperSplat id.
// v0.13 (lane v13-host A5, W18): the counts are the package's, SHIPPED_LESSON_IDS (28: six tunnels and rings-heights more) and
// lessonPaths() (a fast path of 8).
import { describe, expect, it } from 'vitest';
import { SHIPPED_LESSON_IDS, createLessonRunner, getLesson, lessonPaths } from '../../../packages/sonic-fpv/src';
import { buildModel, continueLesson, ladder, lessonPlace, parseSonicParam, stateOf } from '../../../apps/fly/src/sonic/start-model';
import { LESSON_SCENE_PREFIX, isLessonScene, lessonFlightWorld } from '../../../apps/fly/src/sonic/lesson-world';
import { enableZoom } from '../../../apps/fly/src/sonic/zoom';

const done = (attempts = 3, passed = true) => ({ passed, attempts });

describe('the lessons on the screen', () => {
    it('every shipped lesson (28 since v0.13), once, by module in ladder order, whatever the path', () => {
        expect(SHIPPED_LESSON_IDS).toHaveLength(28);
        for (const path of ['full', 'fast'] as const) {
            const m = buildModel({}, null, path);
            const ids = m.modules.flatMap((x) => x.lessons.map((l) => l.id));
            expect(ids).toHaveLength(SHIPPED_LESSON_IDS.length);
            expect(new Set(ids).size).toBe(SHIPPED_LESSON_IDS.length);
            expect([...ids].sort()).toEqual([...SHIPPED_LESSON_IDS].sort());
            expect(ids).toEqual(lessonPaths().full);
            expect(m.modules.map((x) => x.module)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
            for (const mod of m.modules) {
                expect(mod.name).toEqual({ key: `module.${mod.module}.name` });
                for (const l of mod.lessons) expect(getLesson(l.id).module).toBe(mod.module);
            }
        }
    });

    it('the ladder is in order and the fast path marks its lessons (8 since v0.13: the headphones, hover, walls, corridor, a tunnel, two of rings, free flight)', () => {
        expect(ladder().map((l) => l.order)).toEqual([...Array(SHIPPED_LESSON_IDS.length).keys()]);
        const fast = buildModel({}, null, 'fast').modules.flatMap((x) => x.lessons).filter((l) => l.fastPath).map((l) => l.id);
        expect(lessonPaths().fast).toHaveLength(8);
        // in the path's own order too: the screen lists them by order, which is the full path's
        expect(fast).toEqual(lessonPaths().fast);
        expect(fast.sort()).toEqual([...lessonPaths().fast].sort());
    });

    it('only the module-7 lesson flies a scan', () => {
        const scans = buildModel({}, null, 'full').modules.flatMap((x) => x.lessons).filter((l) => l.scan).map((l) => l.id);
        expect(scans).toEqual(['free-garden']);
    });
});

describe('where the pilot stands', () => {
    const progress = { 'ears-headphones': done(2, true), 'hover-height': done(4, false), 'walls-hall': done(10, true) };

    it('passed, in progress (begun, or left off on), new', () => {
        expect(stateOf('ears-headphones', progress, null)).toBe('passed');
        expect(stateOf('hover-height', progress, null)).toBe('current');
        expect(stateOf('corridor', progress, null)).toBe('new');
        expect(stateOf('corridor', progress, 'corridor')).toBe('current');
        // a passed lesson is passed even if it was the one left off on
        expect(stateOf('walls-hall', progress, 'walls-hall')).toBe('passed');
        const rows = buildModel(progress, null, 'full').modules.flatMap((x) => x.lessons);
        expect(rows.find((l) => l.id === 'hover-height')!.state).toBe('current');
        expect(rows.filter((l) => l.state === 'passed').map((l) => l.id)).toEqual(['ears-headphones', 'walls-hall']);
    });

    it('Continue: nothing before a lesson was begun; then the one left off on, else the first of the path not passed', () => {
        expect(continueLesson({}, null, 'full')).toBeNull();
        expect(buildModel({}, null, 'full').continueId).toBeNull();
        expect(continueLesson(progress, 'hover-height', 'full')).toBe('hover-height');
        // the lesson left off on is passed: the first of the path not passed
        expect(continueLesson(progress, 'walls-hall', 'full')).toBe('ears-glossary');
        expect(continueLesson(progress, null, 'fast')).toBe('hover-height');
        // everything on the path passed: the last lesson, not nothing
        const all = Object.fromEntries(lessonPaths().fast.map((id) => [id, done()]));
        expect(continueLesson(all, null, 'fast')).toBe('free-garden');
        // a current lesson that is not a lesson (an old or a hand-edited document) is not offered
        expect(continueLesson({ 'ears-headphones': done(1, false) }, 'no-such-lesson', 'full')).toBe('ears-headphones');
    });

    it('Start opens the first lesson of the path', () => {
        expect(buildModel({}, null, 'full').beginningId).toBe('ears-headphones');
        expect(buildModel({}, null, 'fast').beginningId).toBe('ears-headphones');
        expect(lessonPaths().fast[0]).toBe('ears-headphones');
    });

    it('v0.13 (C2, W7): a lesson left without passing is skipped, until it is passed, unless it is the one the pilot is on again', () => {
        const p = { ...progress, 'rings-first': { passed: false, attempts: 2, skipped: true }, 'hover-turn': { passed: false, attempts: 0, skipped: true }, corridor: { passed: true, attempts: 3, skipped: false } };
        expect(stateOf('rings-first', p, null)).toBe('skipped');
        expect(stateOf('hover-turn', p, null)).toBe('skipped');
        // the one the pilot went back to is in progress; a passed one is passed
        expect(stateOf('rings-first', p, 'rings-first')).toBe('current');
        expect(stateOf('corridor', p, null)).toBe('passed');
        // control: skipped false is no skip
        expect(stateOf('hover-height', { 'hover-height': { passed: false, attempts: 4, skipped: false } }, null)).toBe('current');
        const rows = buildModel(p, 'walls-pillar', 'full').modules.flatMap((x) => x.lessons);
        const by = (s: string): string[] => rows.filter((l) => l.state === s).map((l) => l.id);
        expect(by('skipped')).toEqual(['hover-turn', 'rings-first']);
        expect(by('passed')).toEqual(['ears-headphones', 'walls-hall', 'corridor']);
        expect(by('current')).toEqual(['hover-height', 'walls-pillar']);
        expect(by('new')).toHaveLength(SHIPPED_LESSON_IDS.length - 7);
    });
});

describe('a lesson\'s place, "Lesson N of 28" (C2, M41-2)', () => {
    it('is the place the lesson\'s own view gives (I and the progress panel say it): on the pilot\'s path when the lesson is on it, else on the full one, for every lesson and both paths', () => {
        for (const path of ['full', 'fast'] as const) {
            for (const id of SHIPPED_LESSON_IDS) {
                const v = createLessonRunner(getLesson(id), { path }).view();
                expect(lessonPlace(id, path), `${id} on ${path}`).toEqual({ n: v.lessonIndex, total: v.lessonCount });
            }
            const rows = buildModel({}, null, path).modules.flatMap((x) => x.lessons);
            for (const r of rows) expect(r.place).toEqual(lessonPlace(r.id, path));
        }
        // the full path counts the 28 in the screen's order; the fast path its 8
        expect(SHIPPED_LESSON_IDS.map((id) => lessonPlace(id, 'full').n)).toEqual(ladder().map((l) => l.order + 1).sort((a, b) => a - b));
        expect(lessonPlace('ears-headphones', 'full')).toEqual({ n: 1, total: SHIPPED_LESSON_IDS.length });
        const fast = lessonPaths().fast;
        expect(lessonPlace(fast[1]!, 'fast')).toEqual({ n: 2, total: fast.length });
        // control: counted on the full path whatever the pilot's, the fast path's lessons would say another number than the lesson does
        const fullOnly = (id: string): { n: number; total: number } => lessonPlace(id, 'full');
        const v = createLessonRunner(getLesson(fast[1]!), { path: 'fast' }).view();
        expect(fullOnly(fast[1]!)).not.toEqual({ n: v.lessonIndex, total: v.lessonCount });
    });
});

describe('the best time of a timed lesson', () => {
    it('is shown for the timed lesson (module 7) from the saved progress, and for no other lesson (control), nothing before a time exists', () => {
        const rows = (progress: Parameters<typeof buildModel>[0]) => buildModel(progress, null, 'full').modules.flatMap((x) => x.lessons);
        const none = rows({});
        expect(none.every((l) => l.bestTimeMs === null)).toBe(true);
        const timed = rows({ 'free-garden': { ...done(1), bestTimeMs: 31200 } });
        expect(timed.find((l) => l.id === 'free-garden')!.bestTimeMs).toBe(31200);
        expect(timed.filter((l) => l.bestTimeMs !== null).map((l) => l.id)).toEqual(['free-garden']);
        // a time saved against a lesson that is not timed is not shown (the runner never writes one; a hand-edited file might)
        const odd = rows({ 'hover-height': { ...done(1), bestTimeMs: 5000 } });
        expect(odd.every((l) => l.bestTimeMs === null)).toBe(true);
        // begun, never finished: no time yet
        expect(rows({ 'free-garden': { ...done(1, false), bestTimeMs: null } }).find((l) => l.id === 'free-garden')!.bestTimeMs).toBeNull();
    });
});

describe('?sonic=', () => {
    it('empty, start and menu are the start screen', () => {
        for (const v of [null, '', 'start', 'menu', ' start ']) expect(parseSonicParam(v)).toEqual({ kind: 'start' });
    });

    it('a shipped lesson id is that lesson', () => {
        for (const id of SHIPPED_LESSON_IDS) expect(parseSonicParam(id)).toEqual({ kind: 'lesson', id });
    });

    it('anything else is unknown, shortened, never a path or markup into the page', () => {
        const r = parseSonicParam('../../etc/passwd<script>');
        expect(r.kind).toBe('unknown');
        expect(parseSonicParam('x'.repeat(500))).toEqual({ kind: 'unknown', raw: 'x'.repeat(64) });
        expect(parseSonicParam('Walls-Hall').kind).toBe('unknown');
    });
});

describe('the world a lesson flies in', () => {
    it('every lesson has one but the scan lesson; the ears lessons get a floor at their start; scene ids are lesson ids', () => {
        for (const id of SHIPPED_LESSON_IDS) {
            const l = getLesson(id);
            const w = lessonFlightWorld(l);
            if (l.world.kind === 'scan') {
                expect(w, id).toBeNull();
                continue;
            }
            expect(w, id).not.toBeNull();
            expect(isLessonScene(w!.builtin.scene.id)).toBe(true);
            expect(w!.builtin.scene.id).toBe(`${LESSON_SCENE_PREFIX}${id}`);
            expect(w!.builtin.spawn.slice(0, 3)).toEqual([...l.start.pos]);
            // never a hex SuperSplat id, so the CDN and the scene library never see it
            expect(w!.builtin.scene.id).not.toMatch(/^[0-9a-f]{8}$/);
        }
        const ears = lessonFlightWorld(getLesson('ears-headphones'))!;
        expect(ears.world.spec.generator).toBe('open');
        expect(ears.world.solidAt(0, -0.01, 0)).toBe(true);
        expect(ears.world.solidAt(0, 1.5, 0)).toBe(false);
    });
});

describe('zoom', () => {
    it('the viewport of the mode allows pinch and zoom (the simulator\'s own forbids it)', () => {
        let content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
        const meta = { setAttribute: (k: string, v: string) => { if (k === 'content') content = v; } };
        enableZoom({ querySelector: (sel: string) => (sel === 'meta[name="viewport"]' ? (meta as never) : null) });
        expect(content).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
        expect(content).toMatch(/width=device-width/);
        // control: a page with no viewport tag is left alone
        expect(() => enableZoom({ querySelector: () => null })).not.toThrow();
    });
});
