// Lane editor3, E2.1 (docs/wip/editor3.md D1): the course editor froze the page for 3.5-5.5 s per change because the walls
// check ran on the page's thread (live probe, tools/bench/src/editor3-live.ts). The check moves to a worker: the page edits
// with no walls check and paints the worker's answer. Here: the worker's answer is the same proof as before, a burst of
// changes costs at most two checks and only the newest answer counts, and the page no longer calls wallsCheck.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { edit, freeSpace, generateCourse, openEditor, upgradeTrack, wallsCheck } from '@gsfpv/tracks';
import type { CourseCheck, EditAction, EditorState } from '@gsfpv/tracks';
import { IDENTITY, SPAWN_A, threeRooms } from '../../../packages/tracks/test/worlds';
import { CheckQueue, checkAnswerer } from '../../../apps/fly/src/course/editor/check-core';
import type { FromCheckWorker, ToCheckWorker } from '../../../apps/fly/src/course/editor/check-core';

const COURSE_TS = readFileSync(join(__dirname, '../../../apps/fly/src/app/builtin/course.ts'), 'utf8');

const walls = threeRooms();
const track = generateCourse(freeSpace(walls, { spawn: SPAWN_A }), walls, { seed: 7, scene: { id: '0000aaaa', version: 1 }, transform: IDENTITY, created: '2026-11-13T00:00:00.000Z' });
const course = upgradeTrack(track);
const off: CourseCheck = () => [];
const grid = { flip: false, min: [0, 0, 0] as [number, number, number], res: 1, n: [1, 1, 1] as [number, number, number], leafSize: 4, treeDepth: 1 };

/** the course with gate 0 moved into the floor, made without a check (as the page now edits) */
function intoFloor(): EditorState {
    const s = openEditor(course, off);
    const down: EditAction = { kind: 'move', axis: 1, steps: -Math.round(course.gates[0]!.pos[1] / 0.1) };
    const o = edit(s, down, off);
    expect(o.ok).toBe(true);
    return o.state;
}

describe('editor3: the course check off the page thread', () => {
    it('the worker answers with the same problems as the old check on the page, on the walls it got once', () => {
        const answer = checkAnswerer(() => walls, () => 0);
        expect(answer({ t: 'walls', walls: 1, grid, nodes: new Uint32Array(1), leaf: new Uint32Array(2) })).toBeNull();
        const bad = intoFloor().course;
        const a = answer({ t: 'check', seq: 1, walls: 1, course: bad, transform: IDENTITY as [number, number, number, number], margin: 0.3 });
        expect(a?.t).toBe('checked');
        if (a?.t !== 'checked') return;
        expect(a.problems.length).toBeGreaterThan(0);
        expect(a.problems.some((p) => p.code === 'gate-wall' || p.code === 'leg-wall' || p.code === 'outside')).toBe(true);
        expect(a.problems).toEqual(wallsCheck(walls, IDENTITY, 0.3)(bad));
        const good = answer({ t: 'check', seq: 2, walls: 1, course, transform: IDENTITY as [number, number, number, number], margin: 0.3 });
        expect(good).toEqual({ t: 'checked', seq: 2, problems: [], ms: 0 });
        // a check on walls it does not hold is an error, never a pass
        expect(answer({ t: 'check', seq: 3, walls: 2, course, transform: IDENTITY as [number, number, number, number], margin: 0.3 })?.t).toBe('error');
    });

    it('a burst of changes costs at most two checks; a stale answer is dropped; a save waits for the newest', async () => {
        const posted: ToCheckWorker[] = [];
        const q = new CheckQueue((m) => posted.push(m));
        q.walls(grid, new Uint32Array(1), new Uint32Array(2));
        const s1 = q.ask(course, IDENTITY as [number, number, number, number], 0.3);
        q.ask(course, IDENTITY as [number, number, number, number], 0.3);
        q.ask(course, IDENTITY as [number, number, number, number], 0.3);
        const s4 = q.ask(course, IDENTITY as [number, number, number, number], 0.3);
        expect(posted.filter((m) => m.t === 'check').map((m) => (m.t === 'check' ? m.seq : 0))).toEqual([s1]);
        let saved = false;
        const save = q.settled().then(() => {
            saved = true;
        });
        const stale: FromCheckWorker = { t: 'checked', seq: s1, problems: [{ code: 'no-start' }], ms: 5000 };
        expect(q.answer(stale)).toBeNull();
        // the newest course went to the worker the moment the stale answer came
        expect(posted.filter((m) => m.t === 'check').map((m) => (m.t === 'check' ? m.seq : 0))).toEqual([s1, s4]);
        await Promise.resolve();
        expect(saved).toBe(false);
        expect(q.pending).toBe(true);
        expect(q.answer({ t: 'checked', seq: s4, problems: [], ms: 5000 })).toEqual({ ok: true, problems: [] });
        await save;
        expect(saved).toBe(true);
        expect(q.pending).toBe(false);
    });

    it('the page edits with no walls check on its thread and asks the worker after each change', () => {
        expect(COURSE_TS).not.toMatch(/wallsCheck\(/);
        expect(COURSE_TS).toMatch(/openEditor\(upgradeTrack\(run\.track\), keepProblems, 0\)/);
        expect(COURSE_TS).toMatch(/edit\(ed, k\.edit, keepProblems\)/);
        expect(COURSE_TS).toMatch(/checks\?\.ask\(ed\.course, flownTransform\(\), edMargin\)/);
        expect(COURSE_TS).toMatch(/course\/editor\/check-worker\.ts/);
    });
});
