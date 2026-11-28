// Lane n-save S1 (the owner's wish 1 of 2026-11-20): a course with a gate in a wall, two gates on one spot and a gate 2 m past
// the walls' grid has warnings and no blocker (saveVerdict), and the real API (apps/api/server.py, run here on a local port
// with a temporary data folder) stores it as it is and gives the same gates back. This is the "Save as it is" the page now
// allows: the server never refused it, only the page did (canSave before lane n-save: any problem refused).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrackFile } from '@shramko/sonic-fpv';
import { canSave, openEditor, saveVerdict, toTrackV1, upgradeTrack, wallsCheck, yawQuatStep } from '@gsfpv/tracks';
import { CourseStore } from '../../../apps/fly/src/course/store';
import { IDENTITY, roomWithHole } from '../../../packages/tracks/test/worlds';

const ROOT = join(__dirname, '../../..');
/** lane n-save's ports are 6900-6919 */
const PORT = 6901;
const BASE = `http://127.0.0.1:${PORT}`;
let child: ChildProcess | null = null;
let data = '';
const stop = (): void => {
    if (child && child.exitCode === null) child.kill();
    child = null;
};
process.once('exit', stop);
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

beforeAll(async () => {
    data = mkdtempSync(join(process.env.N_SAVE_TMP ?? tmpdir(), 'n-save-api-'));
    child = spawn(process.env.PYTHON ?? 'python', ['-X', 'utf8', '-u', 'apps/api/server.py'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(PORT), DATA_DIR: data, MIN_FREE_GB: '0' } });
    const end = Date.now() + 30000;
    for (;;) {
        const up = await fetch(`${BASE}/api/tracks?scene=0000aaaa`).then((r) => r.status === 200, () => false);
        if (up) break;
        if (Date.now() > end || child.exitCode !== null) {
            stop();
            throw new Error('apps/api/server.py did not start');
        }
        await sleep(150);
    }
}, 40000);

afterAll(() => {
    stop();
    if (data) rmSync(data, { recursive: true, force: true });
});

type V3 = [number, number, number];
const gate = (id: string, pos: V3) => ({ id, shape: { kind: 'ring', diameter: 1.2, tube: 0.08 }, pos, quat: yawQuatStep(4), direction: 'forward' });
const course = upgradeTrack({
    format: 'shramko-sonic-track/1', id: '0000aaaa-00000001', version: 1, parent: null, title: 'My yard',
    scene: { kind: 'scan', id: '0000aaaa', version: 1 }, transform: [1, 0, 0, 0], laps: 1, start: { pos: [18, 3, 5], yawDeg: 90 },
    // g2 in the room's wall, g3 on g1's spot, g4 2 m past the walls' grid (it ends at x = 30) in the yard's free air
    gates: [gate('g1', [22, 3, 5]), gate('g2', [10.2, 3, 2]), gate('g3', [22.1, 3, 5]), gate('g4', [32, 3, 5])],
    author: { kind: 'person', name: 'Ann' }, generator: null, created: '2026-11-20T00:00:00Z'
} as unknown as TrackFile);

describe('n-save S1: Save as it is reaches the server and is stored', () => {
    it('warnings, no blocker, Save allowed; the local API stores the course and gives the same gates back', async () => {
        const ed = openEditor(course, wallsCheck(roomWithHole(), IDENTITY));
        const v = saveVerdict(ed.course, ed.problems, [], { name: 'Ann', title: 'My yard' });
        expect(v.blockers).toEqual([]);
        expect(v.warnings.map((w) => w.kind)).toEqual(expect.arrayContaining(['in-scan', 'same-place']));
        expect(ed.problems.map((p) => p.code)).not.toContain('outside');
        expect(canSave(ed)).toBe(true);

        const store = new CourseStore((url, init) => fetch(`${BASE}${String(url)}`, init));
        const r = await store.saveMine(toTrackV1(ed.course));
        expect(r.ok, JSON.stringify(r)).toBe(true);
        if (!r.ok) return;
        const back = (await (await fetch(`${BASE}/api/tracks/${r.id}/v${r.version}`)).json()) as TrackFile;
        expect(back.gates.map((g) => [g.id, ...g.pos])).toEqual(course.gates.map((g) => [g.id, ...g.pos]));
    }, 30000);
});
