// Walls W3 (the owner's rule): an action that needs walls gets them by itself and goes on. The order of
// apps/fly/src/walls-first.ts (shipped or published at once, the store, else one build here, then the
// action), and the contract around it: the course, C and V start the walls instead of saying they are
// missing, and no walls or course line says "cannot" or shows a number of the technique, in en, es, pl, ru.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureWalls, withWalls } from '../../../apps/fly/src/walls-first';

const ROOT = join(__dirname, '..', '..', '..');
const text = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const LANGS = ['en', 'es', 'pl', 'ru'] as const;

/** A scan whose walls come from `from`; counts the builds. */
function rig(from: 'shipped' | 'store' | 'build' | 'none' | 'build-queued') {
    const r = { walls: from === 'shipped', builds: 0, took: 0, readyDone: false, queued: false };
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => { release = res; });
    const steps = {
        has: () => r.walls,
        ready: async () => { r.readyDone = true; if (from === 'store') r.queued = true; },
        takeQueued: () => { if (!r.queued) return false; r.took++; r.walls = true; r.queued = false; return true; },
        // 'build-queued': the pilot flew on during the build, so its walls wait for the next start
        build: async () => { r.builds++; await gate; if (from === 'build') r.walls = true; if (from === 'build-queued') r.queued = true; }
    };
    return { r, steps, release: () => release() };
}

describe('ensureWalls: walls first, one build at most', () => {
    it('shipped or published walls: true at once, no build', async () => {
        const { r, steps } = rig('shipped');
        expect(await ensureWalls(steps)()).toBe(true);
        expect(r.builds).toBe(0);
        expect(r.readyDone).toBe(false);
    });
    it('walls from the store waiting for the craft to park are taken now, no build', async () => {
        const { r, steps } = rig('store');
        expect(await ensureWalls(steps)()).toBe(true);
        expect([r.took, r.builds]).toEqual([1, 0]);
    });
    it('no walls anywhere: the build runs once for two callers, both get true', async () => {
        const { r, steps, release } = rig('build');
        const build = ensureWalls(steps);
        const a = build();
        const b = build();
        await Promise.resolve();
        release();
        expect(await Promise.all([a, b])).toEqual([true, true]);
        expect(r.builds).toBe(1);
        // walls in: a third call builds nothing
        expect(await build()).toBe(true);
        expect(r.builds).toBe(1);
    });
    it('a build that brings no walls (out of room) resolves false, and a later call tries again', async () => {
        const { r, steps, release } = rig('none');
        release();
        const build = ensureWalls(steps);
        expect(await build()).toBe(false);
        expect(await build()).toBe(false);
        expect(r.builds).toBe(2);
    });
    it('a build that finished while the pilot flew (walls queued for the next start): the waiting action takes them now', async () => {
        const { r, steps, release } = rig('build-queued');
        release();
        expect(await ensureWalls(steps)()).toBe(true);
        expect([r.builds, r.took]).toEqual([1, 1]);
    });
});

describe('withWalls: the action runs after the walls, on the same scene', () => {
    it('walls there: the action at once, nothing started', async () => {
        const seen: string[] = [];
        const got = await withWalls({ has: () => true, build: async () => { seen.push('build'); return true; }, scene: () => 's', started: () => seen.push('started') }, () => seen.push('then'));
        expect(got).toBe('now');
        expect(seen).toEqual(['then']);
    });
    it('no walls: started, built, then the action (one press)', async () => {
        const seen: string[] = [];
        let walls = false;
        const got = await withWalls({ has: () => walls, build: async () => { seen.push('build'); walls = true; return true; }, scene: () => 's', started: () => seen.push('started') }, () => seen.push('then'));
        expect(got).toBe('built');
        expect(seen).toEqual(['started', 'build', 'then']);
    });
    it('the pilot switched the scene meanwhile: the action does not run on the other scene', async () => {
        let scene = 'a';
        let ran = false;
        const got = await withWalls({ has: () => false, build: async () => { scene = 'b'; return true; }, scene: () => scene }, () => { ran = true; });
        expect([got, ran]).toEqual(['moved', false]);
    });
    it('the build failed: the action does not run', async () => {
        let ran = false;
        const got = await withWalls({ has: () => false, build: async () => false, scene: () => 's' }, () => { ran = true; });
        expect([got, ran]).toEqual(['failed', false]);
    });
    it('the build failed: the action waits and runs when walls come in later, on the same scene', async () => {
        let walls = false;
        let later: (() => void) | null = null;
        let ran = 0;
        const got = await withWalls({ has: () => walls, build: async () => false, scene: () => 's', later: (f) => { later = f; } } as Parameters<typeof withWalls>[0], () => { ran++; });
        expect(got).toBe('failed');
        expect(ran).toBe(0);
        expect(typeof later).toBe('function');
        walls = true;
        (later as unknown as () => void)();
        expect(ran).toBe(1);
    });
    it('the waiting action does not run on another scene', async () => {
        let scene = 's';
        let later: (() => void) | null = null;
        let ran = false;
        await withWalls({ has: () => scene === 'b', build: async () => false, scene: () => scene, later: (f) => { later = f; } } as Parameters<typeof withWalls>[0], () => { ran = true; });
        scene = 'b';
        (later as unknown as (() => void) | null)?.();
        expect(ran).toBe(false);
    });
});

describe('the walls box in flight (review WL-7)', () => {
    const css = text('apps/fly/src/fly.css');
    const wallsSrc = text('apps/fly/src/walls.ts');
    it('H hides the kept box too', () => {
        expect(css).toContain('#ui.hud-flying:not(.hud-off) > .bake-box.keep');
        expect(css).not.toMatch(/#ui\.hud-flying > \.bake-box\.keep/);
    });
    it('the build offer alone does not keep the box over the flight', () => {
        const mount = wallsSrc.slice(wallsSrc.indexOf('// ---- phase C button, shown at once'));
        expect(mount.slice(0, mount.indexOf('o.hook.downloadBaked'))).not.toContain('keep(true)');
    });
});

describe('the course, C and V lead the pilot on (no "walls are missing")', () => {
    const course = text('apps/fly/src/app/builtin/course.ts');
    const wallsFeature = text('apps/fly/src/app/builtin/walls.ts');
    const voxels = text('apps/fly/src/app/builtin/voxels.ts');
    it('generating, loading and editing a course on a scan without walls build the walls first', () => {
        expect(course).not.toContain("t('course.noWalls')");
        expect(course).toMatch(/if \(!w\) return wallsFirst\(\(\) => generate\(seed\)\)/);
        expect(course).toMatch(/if \(!w\) return wallsFirst\(\(\) => void loadServer\(/);
        expect(course).toContain("t('course.wallsFirst')");
    });
    it('C and V on a scan without walls start the build', () => {
        expect(wallsFeature).toMatch(/if \(!ctx\.session\.collision\) void wallsThen\(ctx/);
        expect(wallsFeature).not.toMatch(/collision\) ctx\.hud\.flash\(t\('walls\.none'\)/);
        expect(voxels).toContain('void wallsThen(ctx');
        expect(voxels).not.toContain("t('voxels.noWalls')");
    });
});

describe('walls and course lines in en, es, pl, ru: no "cannot", no number of the technique', () => {
    const fly = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(text(`packages/i18n/locales/fly/${l}.json`)) as Record<string, string>]));
    const crs = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(text(`packages/i18n/locales/fly/course/${l}.json`)) as Record<string, string>]));
    const CANNOT: Record<(typeof LANGS)[number], RegExp> = {
        en: /cannot|could not|can't|can not/i,
        es: /no se puede|no se pud/i,
        pl: /nie da si\u0119|nie uda\u0142o|nie mo\u017cna/i,
        ru: /\u043d\u0435\u043b\u044c\u0437\u044f|\u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c|\u043d\u0435 \u043f\u043e\u043b\u0443\u0447\u0438\u043b\u043e\u0441\u044c|\u043d\u0435\u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e/i
    };
    // a library message, a voxel count, a Gaussian count or limit
    const NUMBER = /\{msg\}|\{voxels\}|\{limit|\{gaussians|gaussian|million|millones|mln|\u043c\u043b\u043d/i;
    const ours = (k: string): boolean => k.startsWith('bake.') || k.startsWith('walls.') || k === 'scenes.noCollisionBadge' || k === 'voxels.noWalls';
    const courseEntry = (k: string): boolean => k.startsWith('course.') && !k.startsWith('course.edit.');
    for (const l of LANGS) {
        it(`${l}: the lines are plain`, () => {
            const bad = [
                ...Object.entries(fly[l]).filter(([k]) => ours(k)),
                ...Object.entries(crs[l]).filter(([k]) => courseEntry(k))
            ].filter(([, v]) => CANNOT[l].test(v) || NUMBER.test(v)).map(([k]) => k);
            expect(bad).toEqual([]);
        });
        it(`${l}: the lines that lead on are there, "no walls, no course" is gone`, () => {
            expect(crs[l]['course.wallsFirst']).toBeTruthy();
            expect(fly[l]['walls.building']).toBeTruthy();
            expect(crs[l]['course.noWalls']).toBeUndefined();
        });
    }
});
