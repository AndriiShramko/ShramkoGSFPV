// Lane edit4s (E7): a refused Save offers small corrections. On the analytic rooms of packages/tracks: a gate turned 180
// degrees is faced along the line and the course passes; a gate pushed into a wall is moved away from it; a fix the whole
// course's check finds a new problem beside is dropped; the offer's and the change list's words exist in all four locales.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canSave, freeSpace, gateAxis, generateCourse, nearestWall, openEditor, upgradeTrack, wallsCheck } from '@gsfpv/tracks';
import type { Course, CourseProblem } from '@gsfpv/tracks';
import { quatMultiply, yawQuat } from '../../../packages/sonic-fpv/src/util/vec';
import { FIX_WORDS, LIFT_ONE_KEY, OFFER_KEYS, OFFER_WORDS, confirmFixes, courseOverview, foundWords, proposeFixes, withFixes } from '../../../apps/fly/src/course/editor/fixes';
import { IDENTITY, SPAWN_A, threeRooms } from '../../../packages/tracks/test/worlds';
import en from '../../../packages/i18n/locales/fly/course-save/en.json';
import es from '../../../packages/i18n/locales/fly/course-save/es.json';
import pl from '../../../packages/i18n/locales/fly/course-save/pl.json';
import ru from '../../../packages/i18n/locales/fly/course-save/ru.json';

const root = join(__dirname, '../../..');
const walls = threeRooms();
const track = generateCourse(freeSpace(walls, { spawn: SPAWN_A }), walls, { seed: 7, scene: { id: '0000aaaa', version: 1 }, transform: IDENTITY, created: '2026-11-13T00:00:00.000Z' });
const course = upgradeTrack(track);
const margin = 0.3;
const check = wallsCheck(walls, IDENTITY, margin);
const w = { col: walls, transform: IDENTITY, margin };
const withGate = (c: Course, i: number, g: Partial<Course['gates'][number]>): Course => ({ ...c, gates: c.gates.map((x, k) => (k === i ? { ...x, ...g } : x)) });

describe('lane edit4s: the corrections a refused Save offers (E7)', () => {
    it('the generated course passes as it is (the fixture holds)', () => {
        expect(course.gates.length).toBeGreaterThan(3);
        expect(check(course)).toEqual([]);
    });

    it('a gate turned 180 degrees is faced along the line, and then the course can be saved', () => {
        const i = 2;
        const g = course.gates[i]!;
        const turned = withGate(course, i, { quat: quatMultiply(yawQuat(180), g.quat) });
        const problems = check(turned);
        expect(problems.some((p) => p.code === 'gate-direction' && p.gate === g.id)).toBe(true);
        const fixes = proposeFixes(turned, problems, w);
        expect(fixes.map((f) => f.kind)).toContain('face-line');
        const r = confirmFixes(turned, problems, fixes, check);
        expect(r.problems).toEqual([]);
        expect(canSave(openEditor(r.course, check))).toBe(true);
        const f = r.fixes.find((x) => x.kind === 'face-line')!;
        expect(f.words).toEqual({ key: FIX_WORDS['face-line'], args: { g: i + 1, deg: expect.any(Number) } });
        expect(f.words.args.deg).toBeGreaterThan(90);
        // only that gate changed, its place kept
        expect(r.course.gates[i]!.pos).toEqual(g.pos);
        r.course.gates.forEach((x, k) => k !== i && expect(x).toEqual(turned.gates[k]));
    });

    it('a gate pushed against a wall is moved away from it, at most 1 m', () => {
        const i = 1;
        const g = course.gates[i]!;
        const hit = nearestWall(walls, g.pos as [number, number, number])!;
        let pushed: Course | null = null;
        let problems: CourseProblem[] = [];
        for (let m = 0.1; m < hit.distance && !pushed; m += 0.1) {
            const c = withGate(course, i, { pos: [g.pos[0] + hit.dir[0] * m, g.pos[1] + hit.dir[1] * m, g.pos[2] + hit.dir[2] * m] });
            problems = check(c);
            if (problems.some((p) => p.code === 'gate-wall' && p.gate === g.id)) pushed = c;
        }
        expect(pushed).not.toBeNull();
        const fixes = proposeFixes(pushed!, problems, w);
        const nudge = fixes.find((f) => f.kind === 'nudge');
        expect(nudge).toBeDefined();
        expect(nudge!.words.args.cm).toBeLessThanOrEqual(100);
        const r = confirmFixes(pushed!, problems, fixes, check);
        expect(r.problems.some((p) => p.code === 'gate-wall' && p.gate === g.id)).toBe(false);
    });

    it('a gate pushed level just into a wall from any side is moved out again (not only away from the nearest ray hit)', () => {
        // a low gate (1.4 m over the floor, its frame clear) pushed along its own axis touches the wall ahead with its run
        // through while the ray from its centre meets the floor first: moving up, away from that hit, never clears it
        const missed: string[] = [];
        let pushes = 0;
        for (const i of [1, 2, 3, 4]) {
            const low = withGate(course, i, { pos: [course.gates[i]!.pos[0], 1.4, course.gates[i]!.pos[2]] });
            if (check(low).length > 0) continue;
            const g = low.gates[i]!;
            const ax = gateAxis(g.quat);
            const level = Math.hypot(ax[0], ax[2]) || 1;
            const ways = [[ax[0] / level, 0, ax[2] / level], [-ax[0] / level, 0, -ax[2] / level]];
            for (let k = 0; k < 8; k++) ways.push([Math.cos((k / 8) * Math.PI * 2), 0, Math.sin((k / 8) * Math.PI * 2)]);
            for (const d of ways) {
                // the first 0.1 m step that makes the gate touch a wall, within 6 m
                for (let m = 0.1; m <= 6; m += 0.1) {
                    const c = withGate(low, i, { pos: [g.pos[0] + d[0]! * m, g.pos[1], g.pos[2] + d[2]! * m] });
                    const problems = check(c);
                    if (problems.length === 0) continue;
                    if (problems.some((p) => p.code === 'gate-wall' && p.gate === g.id) && problems.every((p) => p.code === 'gate-wall' && p.gate === g.id)) {
                        pushes++;
                        const r = confirmFixes(c, problems, proposeFixes(c, problems, w), check);
                        if (r.problems.length > 0 || !r.fixes.some((f) => f.kind === 'nudge')) missed.push(`gate ${i + 1} way ${d.map((v) => v.toFixed(2))} at ${m.toFixed(1)} m`);
                    }
                    break;
                }
            }
        }
        expect(pushes).toBeGreaterThan(3);
        expect(missed).toEqual([]);
    });

    it('a fix the whole check finds a new problem beside is dropped, and the course is left as it was', () => {
        const i = 2;
        const g = course.gates[i]!;
        const turned = withGate(course, i, { quat: quatMultiply(yawQuat(180), g.quat) });
        const problems = check(turned);
        const fixes = proposeFixes(turned, problems, w);
        expect(fixes.length).toBeGreaterThan(0);
        const next = course.gates[i + 1]!.id;
        const spoiled = (c: Course): CourseProblem[] => [...check(c), { code: 'gate-wall', gate: next, freeM: 0 }];
        const r = confirmFixes(turned, problems, fixes, spoiled);
        expect(r.fixes).toEqual([]);
        expect(r.course).toBe(turned);
        expect(withFixes(turned, [])).toBe(turned);
    });

    it('no fix is offered for a problem it cannot clear (the course outside the walls)', () => {
        const far = withGate(course, 1, { pos: [500, 2, 5] });
        const problems = check(far);
        expect(proposeFixes(far, problems, w)).toEqual([]);
    });

    it('the overview sees every gate from above', () => {
        const o = courseOverview(course.gates.map((x) => x.pos as [number, number, number]), Math.tan((60 * Math.PI) / 360), null)!;
        expect(o.eye[1]).toBeGreaterThan(o.at[1]);
    });

    // lane n-save (t7-plan Decision 1): the offer became the Save dialog (save-dialog.test.ts): the page asks before it
    // corrects, the corrections are fixAll's as one undo step, the window keeps its 44 px cross
    it('the page asks before it corrects: Save with warnings goes through the dialog, the window has its 44 px cross', () => {
        const page = readFileSync(join(root, 'apps/fly/src/app/builtin/course.ts'), 'utf8');
        expect(page).toMatch(/return askSave\(v, \(\) => void saveMine\(nameIn, titleIn, true\)\)/);
        expect(page).toMatch(/panel\.askSave\(/);
        expect(page).toMatch(/applyEdit\(\{ kind: 'replace', gates: r\.course\.gates/);
        const css = readFileSync(join(root, 'apps/fly/src/course/editor/keep.css'), 'utf8');
        expect(css).toMatch(/\.ce-fix-close \{[^}]*width: 44px; height: 44px/);
        expect(readFileSync(join(root, 'apps/fly/src/course/editor/panel.ts'), 'utf8')).toMatch(/askSave\(ask: \{ title: string; lines: readonly string\[\] \} \| null/);
    });

    it('the offer and the change list have their words in en, es, pl, ru, with the gates named', () => {
        const keys = [...Object.values(FIX_WORDS), ...Object.values(OFFER_WORDS), ...Object.values(OFFER_KEYS), LIFT_ONE_KEY];
        for (const loc of [en, es, pl, ru] as Record<string, string>[]) for (const k of keys) expect(loc[k], k).toBeTruthy();
        for (const loc of [en, es, pl, ru] as Record<string, string>[]) {
            expect(loc[FIX_WORDS['face-line']]).toContain('{g}');
            expect(loc[FIX_WORDS['face-line']]).toContain('{deg}');
            expect(loc[OFFER_WORDS['leg-wall']]).toContain('{a}');
            expect(loc['course.fix.offer']).toContain('{what}');
        }
        expect(foundWords(course, { code: 'gate-direction', gate: course.gates[3]!.id, deg: 170 })).toEqual({ key: OFFER_WORDS['gate-direction'], args: { g: 4 } });
    });
});
