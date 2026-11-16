// Train 3, lane quiet2 (the lead's N6, the owner's message 54): after the first course finished by sound in the free flight over a
// scan, with the narrator on, one line says that the narrator key switches the narrator off; once, never again (SonicState.narratorTip),
// never with the narrator off, never for a course already lapped before the mode was switched on.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyticCollision } from '../../../packages/collision/src';
import { parseTrack, scanFreeLesson } from '../../../packages/sonic-fpv/src';
import type { TrackFile } from '../../../packages/sonic-fpv/src';
import { narratorTipSaid, setNarratorTipSaid } from '../../../apps/fly/src/sonic/store';
import type { SonicHost } from '../../../apps/fly/src/sonic/store';
import { Rig, SharedCourse } from './sonic-lesson-rig';
import type { RigScan } from './sonic-lesson-rig';
import { REPO } from '../src/evidence';

function garden(): TrackFile {
    const r = parseTrack(readFileSync(join(REPO, 'apps/fly/public/sonic/tracks/7a475d38-rings-v1.json'), 'utf8'));
    if (!r.ok) throw new Error('fixture track');
    return r.value;
}

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
    vi.restoreAllMocks();
});

/** A free flight over the garden scan with its course in the scene; `laps` is the course feature's count of finished laps. */
async function start(o: { laps?: number; off?: boolean; saidBefore?: boolean } = {}): Promise<{ r: Rig; setLaps: (n: number) => void; tips: () => string[] }> {
    const track = garden();
    const T = [5, 0, 0, 0] as const;
    const collision = analyticCollision([-12, -1, -26], [12, 14, 26], 0.25, (_x, y) => y < 0);
    const t = track.start!;
    const scan: RigScan = { sceneId: '7a475d38', collision, sha256: 'flat-floor', track, transform: T, spawn: [T[0] * t.pos[0] + T[1], T[0] * t.pos[1] + T[2], T[0] * t.pos[2] + T[3], t.yawDeg] };
    const shared = new SharedCourse(() => track, { s: T[0], t: [T[1], T[2], T[3]] });
    shared.generate();
    let laps = o.laps ?? 0;
    const free = scanFreeLesson('7a475d38', [5, 0, 0, 0]);
    const r = await Rig.make(free, { scan, course: { ...shared.page(), laps: () => laps } });
    rig = r;
    r.narratorOff = o.off === true;
    r.tipSaid = o.saidBefore === true;
    expect(await r.host.openFree(free)).toBe(true);
    await r.run(60000, null, () => r.host.runner?.phase === 'flying');
    await r.run(200);
    return {
        r,
        setLaps: (n) => void (laps = n),
        tips: () => r.engine.said.filter((s) => s.line.key === 'sonic.say.narratorTip').map((s) => String(s.line.params?.key ?? ''))
    };
}

describe('N6: the narrator hint after the first course by sound', () => {
    it('a lap finished with the narrator on: the hint once, with the narrator key; a second lap and a second course say nothing', async () => {
        const { r, setLaps, tips } = await start();
        expect(tips()).toEqual([]);
        setLaps(1);
        await r.run(300);
        expect(tips()).toEqual(['Shift+V']);
        expect(r.tipMarks).toBe(1);
        setLaps(2);
        await r.run(300);
        setLaps(0);
        await r.run(300);
        setLaps(1);
        await r.run(300);
        expect(tips()).toEqual(['Shift+V']);
        expect(r.tipMarks).toBe(1);
    });

    it('the narrator off: no hint, nothing marked', async () => {
        const { r, setLaps, tips } = await start({ off: true });
        setLaps(1);
        await r.run(300);
        expect(tips()).toEqual([]);
        expect(r.tipMarks).toBe(0);
    });

    it('said in an earlier flight: never again', async () => {
        const { r, setLaps, tips } = await start({ saidBefore: true });
        setLaps(1);
        await r.run(300);
        expect(tips()).toEqual([]);
    });

    it('a course lapped before the switch-on does not count; the next lap does', async () => {
        const { r, setLaps, tips } = await start({ laps: 1 });
        expect(tips()).toEqual([]);
        setLaps(2);
        await r.run(300);
        expect(tips()).toEqual(['Shift+V']);
    });

    it('the mark is kept in the sonic collection, written once', () => {
        const doc: { narratorTip?: boolean } = {};
        let writes = 0;
        const host = {
            collection: () => doc,
            updateCollection: (_id: string, f: (d: typeof doc) => void) => {
                writes++;
                f(doc);
            }
        } as unknown as SonicHost;
        expect(narratorTipSaid(host)).toBe(false);
        setNarratorTipSaid(host);
        setNarratorTipSaid(host);
        expect(narratorTipSaid(host)).toBe(true);
        expect(writes).toBe(1);
    });
});
