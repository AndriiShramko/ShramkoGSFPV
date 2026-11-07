// v0.12 Fly by Sound, lane v12-flight step 10 (docs/wip/v12-plan.md 4.2 and section 8 item 6): module 7, free flight in the Winter Garden
// at x5, through the ring track laid by hand (apps/fly/public/sonic/tracks/7a475d38-rings-v1.json).
//
//   the file     the shipped track is a valid, canonical track of the sound package, version 1, the one the lesson names, for the size the
//                lesson forces (x5); eight rings, each passed forward by the leg that comes to it; the library never takes it edited in place.
//   reading it   the page reads it strictly and holds it to the lesson (id, version, scan, size): every way it can be wrong is refused with its reason
//                (controls), a missing file or a dead network too; the release serves it under the page's base.
//   the prefs    a scan lesson holds the lesson's size and the walls on in the prefs' session layer, the mode takes them off again, and a lesson
//                with a world of its own holds none of it (control).
//   the lines    the page's own spoken lines (a scan is loading, its walls are coarse) are in the engine's dictionaries in all four languages.
//   the walls    (these need the scan's walls in .cache/scenes, 19 MB from the CDN, fetched by every bench that flies a scan; skipped without)
//                Winter Garden's real walls as the session flies them at x5 (16 cm cells): every opening, frame and leg is clear by 0.5 m
//                (tools/bench/src/sonic-track-check.ts, with its controls), the lesson's world over them reads the track's gates and the floor,
//                and the real flight model, flown by the lesson pilot along the legs, passes the lesson through the page's own host: eight
//                gates in order inside their openings, no touch, timed; the best time is kept across pages (a slower lap does not take it,
//                a faster one does); a pilot who does not steer, or does not fly, is not passed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TrackLibrary, createTranslator, getLesson, parseTrack, quatRotate, trackToObjects, validateTrack, writeTrack } from '../../../packages/sonic-fpv/src';
import type { LessonDef, TrackFile, Vec3 } from '../../../packages/sonic-fpv/src';
import { forceScanPrefs, clearScanPrefs, loadLessonTrack, readLessonTrack, scanSessionPrefs, trackUrl, voxelCm, wallsAreCoarse, TrackError } from '../../../apps/fly/src/sonic/scan-lesson';
import { engineDicts, hostLines } from '../../../apps/fly/src/sonic/host-lines';
import { savedProgress } from '../../../apps/fly/src/sonic/store';
import { mkStore } from '../../../packages/prefs/test/helpers';
import { checkTrack, flownCollision, nearestWall, provenMargin, withGateAt } from '../src/sonic-track-check';
import { REPO } from '../src/evidence';
import { loadScene } from '../src/scenes';
import { Rig } from './sonic-lesson-rig';
import type { Control, RigScan } from './sonic-lesson-rig';

const TRACK_FILE = join(REPO, 'apps', 'fly', 'public', 'sonic', 'tracks', '7a475d38-rings-v1.json');
const WALLS = join(REPO, '.cache', 'scenes', '7a475d38', 'scene.voxel.bin');
const haveWalls = existsSync(WALLS);
const text = readFileSync(TRACK_FILE, 'utf8');
const lesson = getLesson('free-garden');
const world = lesson.world as Extract<LessonDef['world'], { kind: 'scan' }>;
const T = world.transform;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
const DEG = Math.PI / 180;

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
    vi.restoreAllMocks();
});

// ------------------------------------------------------------------ the file

describe('the shipped track', () => {
    const track = parseTrack(text);
    if (!track.ok) throw new Error(JSON.stringify(track.issues));
    const t = track.value;

    it('is a valid, canonical track of the sound package, version 1, and is the one the lesson names, for the size the lesson forces', () => {
        expect(validateTrack(JSON.parse(text)).ok).toBe(true);
        // the file is what the package's canonical writer makes of it (keys sorted, two spaces, a final newline): the digest means one thing
        expect(text).toBe(writeTrack(t));
        expect(world.track).toEqual({ id: t.id, version: t.version });
        expect(t.version).toBe(1);
        expect(t.parent).toBeNull();
        expect(t.scene).toMatchObject({ kind: 'scan', id: world.sceneId });
        expect([...t.transform]).toEqual([...T]);
        expect(t.laps).toBe(1);
        expect(t.generator).toBeNull(); // placed by hand
        expect(t.author.kind).toBe('agent');
        expect(() => readLessonTrack(text, world)).not.toThrow();
    });

    it('has 6 to 8 rings of one size, forward, in course order, with a start', () => {
        expect(t.gates.length).toBeGreaterThanOrEqual(6);
        expect(t.gates.length).toBeLessThanOrEqual(8);
        for (const g of t.gates) {
            expect(g.shape.kind).toBe('ring');
            expect(g.direction).toBe('forward');
        }
        expect(new Set(t.gates.map((g) => JSON.stringify(g.shape))).size).toBe(1);
        expect(new Set(t.gates.map((g) => g.id)).size).toBe(t.gates.length);
        expect(t.start).not.toBeNull();
        // the objects the runner gets are the gates through the size, in the order of the file
        const objs = trackToObjects(t, { transform: T });
        expect(objs.map((o) => o.order)).toEqual(t.gates.map((_, i) => i));
        const first = objs[0]!;
        expect(first.shape.kind === 'ring' && first.shape.diameter).toBeCloseTo(3.5, 6); // 0.7 m of the scan, x5
    });

    it('is passed forward and with room between the gates: each gate\'s axis within 35 degrees of the leg that comes to it, 6 m or more apart (flown)', () => {
        const objs = trackToObjects(t, { transform: T });
        const s = t.start!;
        let prev: Vec3 = [T[0] * s.pos[0] + T[1], T[0] * s.pos[1] + T[2], T[0] * s.pos[2] + T[3]];
        let minGap = Infinity;
        for (const o of objs) {
            const leg: Vec3 = [o.pos[0] - prev[0], o.pos[1] - prev[1], o.pos[2] - prev[2]];
            // the gate's nose: local -Z through its quaternion; the leg comes in along it, give or take 35 degrees
            const nose = quatRotate(o.quat, [0, 0, -1]);
            const ang = Math.acos(clamp((nose[0] * leg[0] + nose[1] * leg[1] + nose[2] * leg[2]) / Math.hypot(leg[0], leg[1], leg[2]), -1, 1)) / DEG;
            expect(ang, `gate ${o.id} is ${ang} degrees off the leg that comes to it`).toBeLessThanOrEqual(35);
            minGap = Math.min(minGap, Math.hypot(leg[0], leg[1], leg[2]));
            prev = o.pos;
        }
        expect(minGap).toBeGreaterThanOrEqual(6);
    });

    it('is never taken edited in place: the library keeps it, and refuses the same version with other content (control)', () => {
        const lib = new TrackLibrary();
        expect(lib.add(JSON.parse(text))).toMatchObject({ ok: true, added: true });
        expect(lib.add(JSON.parse(text))).toMatchObject({ ok: true, added: false });
        const edited = JSON.parse(text) as TrackFile & { title: string };
        edited.title = 'moved a ring';
        expect(lib.add(edited)).toMatchObject({ ok: false });
    });
});

// ------------------------------------------------------------------ reading it

describe('reading a track for a scan lesson', () => {
    const edit = (f: (d: Record<string, unknown>) => void): string => {
        const d = JSON.parse(text) as Record<string, unknown>;
        f(d);
        return JSON.stringify(d);
    };

    it('refuses what is not the lesson\'s track, each with its reason (controls: the right file passes)', () => {
        expect(() => readLessonTrack(text, world)).not.toThrow();
        expect(() => readLessonTrack(edit((d) => (d.version = 2)), world)).toThrow(/version/);
        expect(() => readLessonTrack(edit((d) => (d.id = 'other-rings')), world)).toThrow(/7a475d38-rings version 1/);
        expect(() => readLessonTrack(edit((d) => (d.scene = { kind: 'scan', id: 'deadbeef', version: 1 })), world)).toThrow(/deadbeef/);
        expect(() => readLessonTrack(edit((d) => (d.scene = { kind: 'lesson', id: '7a475d38', version: 1 })), world)).toThrow(/lesson 7a475d38/);
        expect(() => readLessonTrack(edit((d) => (d.transform = [1, 0, 0, 0])), world)).toThrow(/size 1, 0, 0, 0/);
        expect(() => readLessonTrack('{ not json', world)).toThrow(/not a valid track|not valid/);
        expect(() => readLessonTrack(edit((d) => ((d.gates as unknown[]).length = 0)), world)).toThrow(TrackError);
        expect(() => readLessonTrack(edit((d) => (d.surprise = 1)), world)).toThrow(/surprise/);
    });

    it('fetches it from the release under the page\'s base, and says what went wrong when it cannot (control: a good answer reads)', async () => {
        expect(trackUrl({ id: '7a475d38-rings', version: 1 })).toBe('/fly/sonic/tracks/7a475d38-rings-v1.json');
        expect(trackUrl({ id: 'x', version: 3 }, '/base')).toBe('/base/sonic/tracks/x-v3.json');
        const urls: string[] = [];
        const ok = (async (u: string) => (urls.push(u), new Response(text, { status: 200 }))) as unknown as typeof fetch;
        expect((await loadLessonTrack(world, ok)).gates.length).toBe(8);
        expect(urls).toEqual(['/fly/sonic/tracks/7a475d38-rings-v1.json']);
        const gone = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
        await expect(loadLessonTrack(world, gone)).rejects.toThrow(/404/);
        const down = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
        await expect(loadLessonTrack(world, down)).rejects.toThrow(/did not load.*Failed to fetch/);
        await expect(loadLessonTrack({ ...world, track: null }, ok)).rejects.toThrow(/names no track/);
        const wrong = (async () => new Response(edit((d) => (d.version = 2)), { status: 200 })) as unknown as typeof fetch;
        await expect(loadLessonTrack(world, wrong)).rejects.toThrow(/version/);
    });
});

// ------------------------------------------------------------------ prefs, lines, walls' words

describe('what a scan lesson holds in the prefs and says', () => {
    it('forces the lesson\'s size and the walls on while a scan lesson runs, and nothing for a lesson with a world of its own (control)', () => {
        expect(scanSessionPrefs(world)).toEqual({ 'scene.transform': { s: 5, t: [0, 0, 0], v: 0 }, 'scene.walls': 'on' });
        expect(scanSessionPrefs(getLesson('hover-height').world)).toBeNull();
        expect(scanSessionPrefs(getLesson('ears-headphones').world)).toBeNull();
        const set = new Map<string, unknown>();
        const store = { setSession: (id: string, v: unknown) => (set.set(id, v), undefined), clearSession: (id?: string) => { if (id) set.delete(id); else set.clear(); } };
        expect(forceScanPrefs(store, getLesson('hover-height').world)).toBe(false);
        expect(set.size).toBe(0);
        expect(forceScanPrefs(store, world)).toBe(true);
        expect([...set.keys()].sort()).toEqual(['scene.transform', 'scene.walls']);
        clearScanPrefs(store);
        expect(set.size).toBe(0);
    });

    it('says the walls are coarse above 10 cm cells (16 cm at x5) and not for fine ones (control), in whole centimetres', () => {
        expect(wallsAreCoarse(0.16)).toBe(true);
        expect(wallsAreCoarse(0.1)).toBe(false);
        expect(wallsAreCoarse(0.08)).toBe(false);
        expect(wallsAreCoarse(null)).toBe(false);
        expect(voxelCm(0.16)).toBe(16);
        expect(voxelCm(0.032)).toBe(3);
    });

    it('has the page\'s spoken lines in the engine\'s dictionaries in en, es, pl and ru, with the walls\' size filled in, the package\'s own keys intact', () => {
        const dicts = engineDicts();
        for (const l of ['en', 'es', 'pl', 'ru'] as const) {
            const keys = Object.keys(hostLines(l)).sort();
            // (the lines of the lesson host; the GPU hint's spoken line joins them in the same namespace, tools/bench/test/sonic-gpuhint.test.ts)
            expect(keys).toEqual(expect.arrayContaining(['sonic.say.scanFailed', 'sonic.say.scanLoading', 'sonic.say.wallsCoarse']));
            expect(keys.every((k) => k.startsWith('sonic.say.'))).toBe(true);
            const tr = createTranslator(l, dicts);
            const said = tr.text({ key: 'sonic.say.wallsCoarse', params: { cm: 16 } });
            expect(said, l).toMatch(/16/);
            expect(said, l).not.toMatch(/[{}]/);
            expect(tr.has('sonic.say.scanLoading')).toBe(true);
            expect(tr.has('lesson.free-garden.title')).toBe(true);
            expect(tr.text({ key: 'sonic.say.scanLoading' })).not.toBe('sonic.say.scanLoading');
        }
        // the same keys without the page's lines are the package's alone (control: the engine would say the bare key)
        expect(createTranslator('en', { en: {}, es: {}, pl: {}, ru: {} }).text({ key: 'sonic.say.wallsCoarse', params: { cm: 16 } })).toBe('sonic.say.wallsCoarse');
    });
});

// ------------------------------------------------------------------ the real walls

/** The guidance of a pilot who looks at the next ring and flies to it: the sticks of a keyboard, a little before each turn. */
const follow = (cruise: number): Control => (r) => {
    const run = r.host.runner;
    if (!run || run.phase !== 'flying') return null;
    const gate = run.target();
    if (!gate) return null;
    const p = r.pos;
    const dx = gate.pos[0] - p[0];
    const dz = gate.pos[2] - p[2];
    const dist = Math.hypot(dx, dz);
    const err = wrap((Math.atan2(dx, -dz) * 180) / Math.PI - r.yaw);
    return {
        turn: clamp(err / 30, -1, 1),
        // not into a turn it cannot make: stand off while the nose is more than 70 degrees away, ease off near the ring
        forward: Math.abs(err) > 70 ? 0 : cruise * Math.cos(err * DEG) * Math.min(1, dist / 4 + 0.3),
        lift: clamp((gate.pos[1] - p[1]) * 0.9, -1, 1)
    };
};

describe.skipIf(!haveWalls)('Winter Garden at x5, on its real walls', () => {
    let scan: RigScan;
    let track: TrackFile;

    beforeAll(async () => {
        const parsed = parseTrack(text);
        if (!parsed.ok) throw new Error('track');
        track = parsed.value;
        const sc = await loadScene('7a475d38');
        const t = track.start!;
        scan = {
            sceneId: '7a475d38',
            collision: flownCollision(sc.collision, T),
            sha256: sc.sha256,
            track,
            transform: T,
            spawn: [T[0] * t.pos[0] + T[1], T[0] * t.pos[1] + T[2], T[0] * t.pos[2] + T[3], t.yawDeg]
        };
    }, 180000);

    it('flies as 16 cm cells: the scan\'s 3.2 cm grid under x5', () => {
        expect(scan.collision.voxelResolution).toBeCloseTo(0.16, 6);
    });

    it('has every opening, frame, run through a gate and leg clear by 0.5 m, flown (the proof of tools/bench/src/sonic-track-check.ts)', () => {
        const r = checkTrack(track, scan.collision, T, 0.5);
        expect(r.issues).toEqual([]);
        expect(r.ok).toBe(true);
        expect(r.gates.length).toBe(8);
        expect(r.legs.length).toBe(8);
        expect(r.startFreeM).toBeGreaterThanOrEqual(0.5);
        expect(r.minFreeM).toBeGreaterThanOrEqual(0.5);
        expect(r.gates.every((g) => g.clear && g.directionOk)).toBe(true);
        expect(r.legs.every((l) => l.clear)).toBe(true);
    }, 180000);

    it('is no empty proof: it holds up to the margin the track has and no further, refuses a ring pushed into a wall, a leg carried through one, and a ring turned round (controls)', () => {
        const proven = provenMargin(track, scan.collision, T);
        expect(proven).toBeGreaterThan(0.5);
        expect(checkTrack(track, scan.collision, T, proven - 0.02, false).ok).toBe(true);
        expect(checkTrack(track, scan.collision, T, proven + 0.02, false).ok).toBe(false);
        const mid = 3;
        const g = trackToObjects(track, { transform: T })[mid]!;
        const wall = nearestWall(scan.collision, g.pos)!;
        expect(wall).not.toBeNull();
        const into = withGateAt(track, mid, [wall.point[0] + wall.dir[0] * 0.3, wall.point[1] + wall.dir[1] * 0.3, wall.point[2] + wall.dir[2] * 0.3], T);
        const ri = checkTrack(into, scan.collision, T, 0.5, false);
        expect(ri.ok).toBe(false);
        expect(ri.issues.some((s) => s.includes(`gate ${g.id}`))).toBe(true);
        const through = withGateAt(track, mid, [wall.point[0] + wall.dir[0] * 6, wall.point[1] + wall.dir[1] * 6, wall.point[2] + wall.dir[2] * 6], T);
        expect(checkTrack(through, scan.collision, T, 0.5, false).legs.some((l) => !l.clear)).toBe(true);
        const turned: TrackFile = { ...track, gates: track.gates.map((gt, i) => (i === mid ? { ...gt, quat: [0, 0, 0, 1] as const } : gt)) };
        const rt = checkTrack(turned, scan.collision, T, 0.5, false);
        expect(rt.ok).toBe(false);
        expect(rt.issues.some((s) => s.includes('deg off the leg in'))).toBe(true);
    }, 300000);

    it('puts the lesson\'s world over the scan: the gates flown, the start, the floor under it, rays that meet a ring\'s tube, coarse walls to say so', async () => {
        rig = await Rig.make(lesson, { scan });
        const page = (rig.host as unknown as { p: { scanLesson(l: LessonDef): Promise<import('../../../apps/fly/src/sonic/scan-lesson').ScanLesson | null> } }).p;
        const s = (await page.scanLesson(lesson))!;
        expect(s.objects.length).toBe(8);
        expect(s.prims.filter((p) => p.role === 'gate').length).toBe(8);
        expect(s.start.pos).toEqual([2.5, 6.25, -17]);
        expect(s.start.yawDeg).toBe(180);
        // the floor of the hall, from the walls: Winter Garden's floor is at about -0.29 m of the scan, x5
        expect(s.floorY).toBeGreaterThan(-1.7);
        expect(s.floorY).toBeLessThan(-1.2);
        expect(s.voxelM).toBeCloseTo(0.16, 6);
        expect(wallsAreCoarse(s.voxelM)).toBe(true);
        // a ray down from the start meets the floor
        const down = s.world.castRay(s.start.pos, [0, -1, 0], 40)!;
        expect(down.material).toBe('floor');
        expect(down.distance).toBeCloseTo(s.start.pos[1] - s.floorY, 1);
        // a ray along ring 1's axis passes through its opening; one aimed at its tube meets it ('obstacle', its id)
        const g = s.objects[0]!;
        const dia = g.shape.kind === 'ring' ? g.shape.diameter : 0;
        const before: Vec3 = [g.pos[0], g.pos[1], g.pos[2] + 3];
        const through = s.world.castRay(before, [0, 0, -1], 1.5);
        expect(through === null || through.objectId === null).toBe(true);
        const tube: Vec3 = [g.pos[0] + dia / 2 + 0.12, g.pos[1], g.pos[2]];
        const toTube = s.world.castRay([tube[0], tube[1], tube[2] + 3], [0, 0, -1], 4)!;
        expect(toTube.objectId).toBe(g.id);
        expect(toTube.material).toBe('obstacle');
    }, 180000);

    it('is passed end to end through the page\'s own host by a pilot who flies to each ring: eight gates in order inside their openings, no touch, timed', async () => {
        rig = await Rig.make(lesson, { scan });
        expect(await rig.host.open('free-garden')).toBe(true);
        // the lesson's size and the walls on are held while it runs; the craft waits at the track's start
        expect(rig.sessionPrefs.get('scene.transform')).toEqual({ s: 5, t: [0, 0, 0], v: 0 });
        expect(rig.sessionPrefs.get('scene.walls')).toBe('on');
        expect(rig.session.spawn).toEqual(scan.spawn);
        await rig.run(600000, follow(0.6), () => rig!.passed);
        const gates = rig.of('gate');
        const touches = rig.of('touch').length;
        expect(rig.passed, `gates ${gates.map((g) => g.gateId).join(',')} touches ${touches} events ${JSON.stringify(rig.sonic.filter((e) => e.kind === 'lesson' || e.kind === 'goal').slice(-6))}`).toBe(true);
        expect(gates.map((g) => g.gateId)).toEqual(track.gates.map((gt) => gt.id));
        expect(gates.every((g) => g.missM <= 1.75)).toBe(true); // inside the 3.5 m ring's opening
        expect(touches).toBe(0);
        const p = rig.host.runner!.progress();
        expect(p.passed).toBe(true);
        expect(p.bestTimeMs).not.toBeNull();
        const ms = p.bestTimeMs as number;
        // 66.9 m of path, flown at 0.6 of the 5 m/s cap, turning: tens of seconds, never faster than the cap allows
        expect(ms).toBeGreaterThan(66855 / 5.5);
        expect(ms).toBeLessThan(180000);
        // the lesson said its time as a best time, then its pass line; progress is saved with the best time
        const keys = rig.engine.said.map((s) => s.line.key);
        expect(keys).toContain('fly.best-time');
        expect(keys).toContain('lesson.free-garden.pass');
        expect(savedProgress(rig.store, 'free-garden')).toMatchObject({ passed: true, bestTimeMs: ms });
        // the helper's view: the track's eight rings were drawn over the scan, the next one lit as the target moved
        expect(rig.shown.at(-1)!.ids.length).toBe(8);
        expect(rig.stage.cleared).toBeGreaterThanOrEqual(0);
        // the walls were said to be coarse, with their size (the intro first, then the line)
        const coarse = rig.engine.said.find((s) => s.line.key === 'sonic.say.wallsCoarse');
        expect(coarse?.line.params).toEqual({ cm: 16 });
        expect(rig.engine.said.findIndex((s) => s.line.key === 'sonic.say.wallsCoarse')).toBeGreaterThan(rig.engine.said.findIndex((s) => s.line.key === 'lesson.free-garden.intro.1'));
        // leaving the mode gives the lesson's size and walls back
        rig.mode.leave();
        expect(rig.sessionPrefs.has('scene.transform')).toBe(false);
        expect(rig.sessionPrefs.has('scene.walls')).toBe(false);
        // eslint-disable-next-line no-console
        console.info(`MEASURED garden lap: ${ms} ms of page time, ${gates.length} gates, ${touches} touches, ${rig.session.sim.tick} ticks`);
    }, 600000);

    it('keeps the best time across pages: a slower lap does not take it, a faster one does', async () => {
        const store = mkStore();
        const first = await Rig.make(lesson, { scan, store });
        rig = first;
        expect(await first.host.open('free-garden')).toBe(true);
        await first.run(600000, follow(0.5), () => first.passed);
        expect(first.passed).toBe(true);
        const base = savedProgress(store, 'free-garden')!.bestTimeMs as number;
        first.dispose();
        // a new page on the same saved state: the runner goes on from the saved best time
        const slow = await Rig.make(lesson, { scan, store });
        rig = slow;
        expect(await slow.host.open('free-garden')).toBe(true);
        expect(slow.host.runner!.progress().bestTimeMs).toBe(base);
        await slow.run(900000, follow(0.28), () => slow.passed);
        expect(slow.passed).toBe(true);
        const slowKeys = slow.engine.said.map((s) => s.line.key);
        expect(slowKeys).toContain('fly.time');
        expect(slowKeys).not.toContain('fly.best-time');
        expect(savedProgress(store, 'free-garden')!.bestTimeMs).toBe(base);
        slow.dispose();
        const fast = await Rig.make(lesson, { scan, store });
        rig = fast;
        expect(await fast.host.open('free-garden')).toBe(true);
        await fast.run(600000, follow(0.95), () => fast.passed);
        expect(fast.passed).toBe(true);
        const best = savedProgress(store, 'free-garden')!.bestTimeMs as number;
        expect(best).toBeLessThan(base);
        expect(fast.engine.said.map((s) => s.line.key)).toContain('fly.best-time');
        // eslint-disable-next-line no-console
        console.info(`MEASURED best times: 0.5 of the cap ${base} ms, 0.28 kept it, 0.95 of the cap ${best} ms`);
    }, 1800000);

    it('does not pass a pilot who does not steer or does not fly (controls: the pass is the pilot\'s, not the host\'s)', async () => {
        rig = await Rig.make(lesson, { scan });
        expect(await rig.host.open('free-garden')).toBe(true);
        // nose along the course, never turning: the ring the course turns back at is missed, and the course is not finished
        await rig.run(90000, (r) => (r.host.runner?.phase === 'flying' ? { forward: 0.6 } : null), () => rig!.passed);
        expect(rig.passed).toBe(false);
        expect(rig.of('gate').length).toBeLessThan(8);
        rig.dispose();
        rig = await Rig.make(lesson, { scan });
        expect(await rig.host.open('free-garden')).toBe(true);
        await rig.run(90000, () => null, () => rig!.passed);
        expect(rig.passed).toBe(false);
        expect(rig.of('gate').length).toBe(0);
    }, 600000);

    it('hands the size and walls back when a lesson with a world of its own opens after it (control: the analytic lesson holds none)', async () => {
        rig = await Rig.make(lesson, { scan });
        expect(await rig.host.open('free-garden')).toBe(true);
        expect(rig.sessionPrefs.has('scene.transform')).toBe(true);
        // the rig's page swaps to a lesson world as the page does; open() enters the mode again, which leaves it first
        expect(await rig.host.open('hover-height')).toBe(true);
        expect(rig.sessionPrefs.has('scene.transform')).toBe(false);
        expect(rig.sessionPrefs.has('scene.walls')).toBe(false);
        expect(rig.sessionPrefs.get('crash.enabled')).toBe(false);
    }, 180000);
});
