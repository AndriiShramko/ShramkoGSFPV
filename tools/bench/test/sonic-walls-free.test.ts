// Walls lane, stage V1-finish (the owner's rule: do not report that something is missing, lead him on): the free flight by
// sound over a scan without walls gets its walls built by itself (the page's walls hook, feature.ts through wallsThen), says the
// build and that it goes on, and opens again with the walls when they are in; a failed build says one line and the flight goes on.
// Never the old line that sent the pilot to the simulator's pause menu (sonic.say.scanNoWalls).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyticCollision } from '../../../packages/collision/src';
import { Rig } from './sonic-lesson-rig';
import type { RigScan } from './sonic-lesson-rig';
import { parseTrack, scanFreeLesson } from '../../../packages/sonic-fpv/src';
import type { TrackFile } from '../../../packages/sonic-fpv/src';
import { REPO } from '../src/evidence';

function garden(): TrackFile {
    const r = parseTrack(readFileSync(join(REPO, 'apps/fly/public/sonic/tracks/7a475d38-rings-v1.json'), 'utf8'));
    if (!r.ok) throw new Error('fixture track');
    return r.value;
}

function scanOf(track: TrackFile): RigScan {
    const T = [5, 0, 0, 0] as const;
    const t = track.start!;
    return {
        sceneId: '7a475d38',
        collision: analyticCollision([-12, -1, -26], [12, 14, 26], 0.25, (_x, y) => y < 0),
        sha256: 'flat-floor',
        track,
        transform: T,
        spawn: [T[0] * t.pos[0] + T[1], T[0] * t.pos[1] + T[2], T[0] * t.pos[2] + T[3], t.yawDeg]
    };
}

describe('the free flight by sound over a scan without walls builds them and goes on', () => {
    let rig: Rig | null = null;
    afterEach(() => {
        rig?.dispose();
        rig = null;
        vi.restoreAllMocks();
    });

    async function start(): Promise<{ r: Rig; said: (k: string) => boolean; builds: () => number; finish: (ok: boolean) => void }> {
        const track = garden();
        const free = scanFreeLesson('7a475d38', [5, 0, 0, 0]);
        let builds = 0;
        let finish: (ok: boolean) => void = () => undefined;
        const r = await Rig.make(free, {
            scan: scanOf(track),
            course: { key: () => 'N', ask: async () => ({ ok: false, why: 'none fits' }) },
            walls: {
                build: () =>
                    new Promise<boolean>((ok) => {
                        builds++;
                        finish = (v) => {
                            if (v) r.session.collision = walls;
                            ok(v);
                        };
                    })
            }
        });
        rig = r;
        // the scan is flown without walls until the build puts them in
        const walls = r.session.collision!;
        r.session.collision = null;
        expect(await r.host.openFree(free)).toBe(true);
        return { r, said: (k) => r.engine.said.some((s) => s.line.key === k), builds: () => builds, finish: (ok) => finish(ok) };
    }

    it('says the build, says it goes on, and when the walls are in opens the free flight with them (the course offer)', async () => {
        const { r, said, builds, finish } = await start();
        await r.run(60000, null, () => said('sonic.say.wallsBuilding') && r.host.runner?.phase === 'flying');
        expect(said('sonic.say.wallsBuilding')).toBe(true);
        expect(said('sonic.say.scanNoWalls')).toBe(false);
        expect(builds()).toBe(1);
        // the build goes on: said again after WALLS_STILL_MS of the page clock
        await r.run(25000);
        expect(said('sonic.say.wallsStill')).toBe(true);
        expect(said('sonic.say.courseOffer')).toBe(false);
        finish(true);
        await r.run(60000, null, () => said('sonic.say.courseOffer'));
        expect(said('sonic.say.wallsIn')).toBe(true);
        expect(said('sonic.say.courseOffer')).toBe(true);
        expect(r.host.runner?.phase === 'intro' || r.host.runner?.phase === 'flying').toBe(true);
        // one build only, and no further "still building" once the walls are in
        expect(builds()).toBe(1);
        const still = r.engine.said.filter((s) => s.line.key === 'sonic.say.wallsStill').length;
        await r.run(25000);
        expect(r.engine.said.filter((s) => s.line.key === 'sonic.say.wallsStill').length).toBe(still);
    }, 120000);

    it('a failed build says one line and the flight goes on, without the old pause-menu line', async () => {
        const { r, said, finish } = await start();
        await r.run(60000, null, () => said('sonic.say.wallsBuilding') && r.host.runner?.phase === 'flying');
        finish(false);
        await r.run(2000);
        expect(said('sonic.say.wallsFailed')).toBe(true);
        expect(said('sonic.say.wallsIn')).toBe(false);
        expect(said('sonic.say.scanNoWalls')).toBe(false);
        expect(r.host.runner?.phase).toBe('flying');
    }, 120000);
});
