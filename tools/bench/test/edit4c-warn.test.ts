// Lane edit4c stage C1w (docs/wip/edit4c.md; design edit4.md 5 C1, complaint E11, brief 561): while a gate drags into a
// place that breaks the course the page warns at once (a tag, the gate orange), on the release it asks 'Keep it here?' and
// a kept gate stays orange until the warning is gone. The pure parts: the live state, the paint, the words, the box's place.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { freeSpace, generateCourse, upgradeTrack } from '@gsfpv/tracks';
import type { Course } from '@gsfpv/tracks';
import { IDENTITY, SPAWN_A, threeRooms } from '../../../packages/tracks/test/worlds';
import { courseFacing } from '../../../apps/fly/src/course/editor/course-line';
import { gateFlownPose, type V3 } from '../../../apps/fly/src/course/editor/drag';
import { KEEP_ASK_MS, WARN_CLEAR_PX, WARN_EVERY_MS, warnPlace, warnedGates } from '../../../apps/fly/src/course/editor/warn';
import { LiveWarnings } from '../../../apps/fly/src/course/editor/warn-live';
import { editPaints } from '../../../apps/fly/src/course/editor/rules';
import { MORE_KEY, PIECE_KEYS, WARN_KEYS, WARN_LEG_WALL_START_KEY, warnLines, warnText } from '../../../apps/fly/src/course/editor/pieces-texts';

const walls = threeRooms();
const TR = [1, 0, 0, 0] as const;
const base = upgradeTrack(generateCourse(freeSpace(walls, { spawn: SPAWN_A }), walls, { seed: 7, scene: { id: '0000aaaa', version: 1 }, transform: IDENTITY, created: '2026-11-19T00:00:00.000Z' }));
function course(at: readonly V3[]): Course {
    const g0 = base.gates[0]!;
    const gates = at.map((p, i) => ({ ...g0, id: `g${i + 1}`, pos: [p[0], p[1], p[2]] as [number, number, number], quat: courseFacing(i > 0 ? at[i - 1]! : [p[0], p[1], p[2] + 1], p, null) as [number, number, number, number] }));
    return { ...base, gates, start: base.start ? { ...base.start, pos: [at[0]![0], at[0]![1], at[0]![2] + 1] } : null };
}
const moved = (c: Course, i: number, pos: V3): Course => ({ ...c, gates: c.gates.map((g, k) => (k === i ? { ...g, pos: [pos[0], pos[1], pos[2]] as [number, number, number] } : g)) });

describe('edit4c C1w: the live warnings of a drag', () => {
    const c = course([[2, 2.5, 8], [2, 2.5, 2], [8, 2.5, 2], [8, 2.5, 8]]);
    const near: V3 = [7.5, 2.5, 2.2];

    it('a drag next to another gate warns at once, the gate painted orange; at most every WARN_EVERY_MS', () => {
        const lw = new LiveWarnings({ flown: () => TR, walls: () => walls, margin: () => 0.3 });
        const ws = lw.during(c, 1, { ...gateFlownPose(c.gates[1]!, TR), pos: near }, 1000);
        expect(ws).toContainEqual({ code: 'too-close', gate: 1, other: 2 });
        // the next pointer move inside the interval is not worked out again (the sweeps of two legs)
        expect(lw.during(c, 1, { ...gateFlownPose(c.gates[1]!, TR), pos: [2, 2.5, 2] }, 1000 + WARN_EVERY_MS - 1)).toBeNull();
        expect(lw.during(c, 1, { ...gateFlownPose(c.gates[1]!, TR), pos: [2, 2.5, 2] }, 1000 + WARN_EVERY_MS)).toEqual([]);
        lw.during(c, 1, { ...gateFlownPose(c.gates[1]!, TR), pos: near }, 2000);
        const dragging = moved(c, 1, near);
        expect([...lw.painted(dragging, true)]).toEqual([1]);
        // the selected gate drawn orange while it warns, yellow when not; red still marks another refused gate
        const ids = c.gates.map((g) => g.id);
        expect(editPaints(ids, 1, [], lw.painted(dragging, true))).toEqual(['later', 'warn', 'later', 'later']);
        expect(editPaints(ids, 1, [])).toEqual(['later', 'selected', 'later', 'later']);
        expect(editPaints(ids, 1, [{ code: 'gate-wall', gate: 'g3' } as never], new Set([1, 2]))).toEqual(['later', 'warn', 'bad', 'later']);
    });

    it('on the release it gives the warnings; kept, the gate stays orange until it is fixed; not kept, it is not', () => {
        const lw = new LiveWarnings({ flown: () => TR, walls: () => walls, margin: () => 0.3 });
        const after = moved(c, 1, near);
        lw.during(after, 1, gateFlownPose(after.gates[1]!, TR), 0);
        const ws = lw.released(after, 1);
        expect(ws.map((w) => w.code)).toContain('too-close');
        // the drag is over: nothing orange before the pilot keeps it (Put back / undo leaves no mark)
        expect([...lw.painted(after, false)]).toEqual([]);
        lw.keep('g2');
        expect([...lw.painted(after, false)]).toEqual([1]);
        expect(lw.keptIds()).toEqual(['g2']);
        // moved back where it breaks nothing: no longer orange, no longer kept
        expect([...lw.painted(c, false)]).toEqual([]);
        expect(lw.keptIds()).toEqual([]);
        // a release into a good place gives none
        expect(lw.released(c, 1)).toEqual([]);
    });

    it('a sharp turn also paints the next gate, the one that can no longer be entered forward', () => {
        expect([...warnedGates([{ code: 'sharp-turn', gate: 2 }], 1)].sort()).toEqual([1, 2]);
        expect([...warnedGates([], 1)]).toEqual([]);
        expect(KEEP_ASK_MS).toBe(8000);
    });
});

describe('edit4c C1w: the words and the box', () => {
    it('each warning has its words with the gate numbers as the gate line counts them (from 1)', () => {
        expect(warnText({ code: 'too-close', gate: 1, other: 2 })).toEqual({ key: WARN_KEYS['too-close'], vars: { gate: 2, other: 3 } });
        expect(warnText({ code: 'leg-wall', gate: -1, other: 0 })).toEqual({ key: WARN_LEG_WALL_START_KEY, vars: { other: 1 } });
        expect(warnText({ code: 'leg-long', gate: 2, other: 3 }).vars).toEqual({ gate: 3, other: 4, max: 60 });
        expect(warnText({ code: 'sharp-turn', gate: 4 })).toEqual({ key: WARN_KEYS['sharp-turn'], vars: { gate: 5 } });
        const many = warnLines([{ code: 'sharp-turn', gate: 1 }, { code: 'too-close', gate: 1, other: 2 }, { code: 'wall-in-opening', gate: 1 }, { code: 'leg-wall', gate: 0, other: 1 }]);
        expect(many.length).toBe(3);
        expect(many[2]).toEqual({ key: MORE_KEY, vars: { n: 2 } });
    });

    it('the four languages have every key, the same keys, and the same {values} in each text', () => {
        const read = (l: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../../../packages/i18n/locales/fly/course-pieces/${l}.json`, import.meta.url), 'utf8'));
        const en = read('en');
        expect(Object.keys(en).sort()).toEqual([...PIECE_KEYS].sort());
        const vars = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
        for (const l of ['es', 'pl', 'ru']) {
            const d = read(l);
            expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
            for (const k of PIECE_KEYS) expect({ l, k, v: vars(d[k]!) }).toEqual({ l, k, v: vars(en[k]!) });
        }
        // the key's letter comes after the word 'key' (the owner's rule)
        expect(en['course.piece.putBack']).toContain('key Ctrl+Z');
    });

    it('the box stands above the gate, else under the gate bar, else under the top bar; inside the page', () => {
        // 1536x730 (the owner's laptop), the gate in the middle: above it
        expect(warnPlace([768, 400, 1], 1536, 730, 320, 120, 52)).toEqual([608, 400 - WARN_CLEAR_PX - 120]);
        // the gate high on the page: below the gate bar (bar 44 px tall at WARN_CLEAR_PX under the gate)
        expect(warnPlace([768, 150, 1], 1536, 730, 320, 120, 52)).toEqual([608, 150 + WARN_CLEAR_PX + 44 + 8]);
        // a phone 844x390: neither fits, it goes just under the top bar
        expect(warnPlace([422, 195, 1], 844, 390, 320, 120, 52)).toEqual([262, 60]);
        // kept inside the page at the edge, hidden behind the camera
        expect(warnPlace([5, 400, 1], 1536, 730, 320, 120, 52)![0]).toBe(8);
        expect(warnPlace([768, 400, -1], 1536, 730, 320, 120, 52)).toBeNull();
    });

    it('review: key Esc closes the open question first, then adding, only then the editor; Add answers the question', async () => {
        // read through the module object: on the old code the names are absent and the expectations fail (no import error)
        const w = (await import('../../../apps/fly/src/course/editor/warn')) as Record<string, unknown>;
        const escTarget = w.escTarget as ((asking: boolean, adding: boolean) => string) | undefined;
        const addClosesQuestion = w.addClosesQuestion as ((arming: boolean, asking: boolean) => boolean) | undefined;
        expect(typeof escTarget).toBe('function');
        expect(typeof addClosesQuestion).toBe('function');
        expect(escTarget!(true, false)).toBe('question');
        expect(escTarget!(true, true)).toBe('question');
        expect(escTarget!(false, true)).toBe('adding');
        expect(escTarget!(false, false)).toBe('editor');
        expect(addClosesQuestion!(true, true)).toBe(true);
        expect(addClosesQuestion!(false, true)).toBe(false);
        expect(addClosesQuestion!(true, false)).toBe(false);
        // the page uses them: Esc's order in the edit view's keydown and the Add list's arming
        const src = readFileSync(new URL('../../../apps/fly/src/app/builtin/course.ts', import.meta.url), 'utf8');
        expect(src).toMatch(/escTarget\(\(warnBar\?\.asking\(\) \?\? null\) !== null, !!view\?\.adding\)/);
        expect(src).toMatch(/if \(addClosesQuestion\(on, \(warnBar\?\.asking\(\) \?\? null\) !== null\)\) warnBar\?\.dismiss\(\);/);
    });
});
