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
import { describe, expect, it } from 'vitest';
import { SHIPPED_LESSON_IDS, getLesson, lessonPaths } from '../../../packages/sonic-fpv/src';
import { buildModel, continueLesson, ladder, parseSonicParam, stateOf } from '../../../apps/fly/src/sonic/start-model';
import { LESSON_SCENE_PREFIX, isLessonScene, lessonFlightWorld } from '../../../apps/fly/src/sonic/lesson-world';
import { enableZoom } from '../../../apps/fly/src/sonic/zoom';

const done = (attempts = 3, passed = true) => ({ passed, attempts });

describe('the lessons on the screen', () => {
    it('all 21 shipped lessons, once, by module in ladder order, whatever the path', () => {
        for (const path of ['full', 'fast'] as const) {
            const m = buildModel({}, null, path);
            const ids = m.modules.flatMap((x) => x.lessons.map((l) => l.id));
            expect(ids).toHaveLength(21);
            expect(new Set(ids).size).toBe(21);
            expect([...ids].sort()).toEqual([...SHIPPED_LESSON_IDS].sort());
            expect(ids).toEqual(lessonPaths().full);
            expect(m.modules.map((x) => x.module)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
            for (const mod of m.modules) {
                expect(mod.name).toEqual({ key: `module.${mod.module}.name` });
                for (const l of mod.lessons) expect(getLesson(l.id).module).toBe(mod.module);
            }
        }
    });

    it('the ladder is in order and the fast path marks six of them (hover, walls, corridor, rings, free flight and the headphones)', () => {
        expect(ladder().map((l) => l.order)).toEqual([...Array(21).keys()]);
        const fast = buildModel({}, null, 'fast').modules.flatMap((x) => x.lessons).filter((l) => l.fastPath).map((l) => l.id);
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
