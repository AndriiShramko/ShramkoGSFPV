// Second check of lane n-save: a gate far past the scan's grid (more than NEAR_GRID_M, the editor's problem 'outside') is
// a warning of kind 'in-scan' (t7-plan Part C 4). The Save dialog's line for that kind must not tell the pilot the gate is
// "inside a wall" when it stands in the free air outside the scan: the owner's rule "a problem says what it is".
import { describe, expect, it } from 'vitest';
import type { TrackFile } from '@shramko/sonic-fpv';
import { NEAR_GRID_M, saveVerdict, upgradeTrack, wallsCheck, yawQuatStep, type Course } from '@gsfpv/tracks';
import { IDENTITY, threeRooms } from '../../../packages/tracks/test/worlds';
import { saveAskWords } from '../../../apps/fly/src/course/editor/save-words';
import en from '../../../packages/i18n/locales/fly/course-save/en.json';
import es from '../../../packages/i18n/locales/fly/course-save/es.json';
import pl from '../../../packages/i18n/locales/fly/course-save/pl.json';
import ru from '../../../packages/i18n/locales/fly/course-save/ru.json';

type V3 = [number, number, number];
const ring = (id: string, pos: V3) => ({ id, shape: { kind: 'ring', diameter: 1.2, tube: 0.08 }, pos, quat: yawQuatStep(4), direction: 'forward' });
const course = (gates: ReturnType<typeof ring>[]): Course =>
    upgradeTrack({
        format: 'shramko-sonic-track/1', id: '0000aaaa-00000001', version: 1, parent: null, title: 'Far out',
        scene: { kind: 'scan', id: '0000aaaa', version: 1 }, transform: [1, 0, 0, 0], gates, laps: 1,
        start: { pos: [1.5, 2.5, 5], yawDeg: 90 }, author: { kind: 'person', name: 'pilot' }, generator: null, created: '2026-11-20T00:00:00Z'
    } as unknown as TrackFile);

describe('n-save second check: the words of a gate outside the scan', () => {
    it('a gate far past the grid is named outside the scan in the Save dialog, not only "inside a wall"', () => {
        const walls = threeRooms();
        const c = course([ring('g1', [3, 2.5, 5]), ring('g2', [3, 2.5 + 4 * NEAR_GRID_M, 5])]);
        const problems = wallsCheck(walls, IDENTITY, 0.5)(c);
        expect(problems.map((p) => p.code)).toContain('outside');
        const v = saveVerdict(c, problems);
        expect(v.blockers).toEqual([]);
        const line = saveAskWords(v.warnings, c.gates.map((g) => g.id)).lines.find((l) => l.kind === 'in-scan');
        expect(line?.args.gates).toBe('2');
        const text = (en as Record<string, string>)[line!.key]!.replace('{gates}', String(line!.args.gates));
        expect(text).toMatch(/outside/i);
        expect(text).toMatch(/wall/i);
        for (const words of [es, pl, ru] as Record<string, string>[]) {
            expect(words[line!.key]).toContain('{gates}');
            expect(words[line!.key]).not.toBe((en as Record<string, string>)[line!.key]);
        }
    });
});
