// Train 3, lane sonic3 (docs/wip/sonic3-plan.md "The direct road"): Fly by Sound switched on in place, in any scene. The owner,
// message 51: "I already said that this flying by sound must be switched on for any scene." Held here: Backslash is bound on
// every page; the pause item switches the mode in this tab (no link, no new tab) and the lessons stay a second item; the switch
// sets and clears the page's entry, says the introduction once to a first-timer; the free flight opened in place keeps the
// craft where it is. Each block has a negative control: it fails by an assertion on origin/main's keymap.ts, sonic-flight.ts
// and lessons.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEYMAP, actionFor, keymapProblems } from '../../../packages/prefs/src/keymap';
import { hereItems, sonicFlight } from '../../../apps/fly/src/app/builtin/sonic-flight';
import type { HereSwitch } from '../../../apps/fly/src/app/builtin/sonic-flight';
import type { MenuItem } from '../../../apps/fly/src/app/context';
import { InPlaceSwitch, failedLine, firstTimer, freeHere } from '../../../apps/fly/src/sonic/in-place-model';
import type { InPlaceDeps } from '../../../apps/fly/src/sonic/in-place-model';
import type { SonicEntry } from '../../../apps/fly/src/sonic/entry';
import { analyticCollision } from '../../../packages/collision/src';
import { S } from '../../../packages/sim-core/src';
import { Rig } from './sonic-lesson-rig';
import type { RigScan } from './sonic-lesson-rig';
import { SCAN_FREE_ID, parseTrack, scanFreeLesson } from '../../../packages/sonic-fpv/src';
import type { TrackFile } from '../../../packages/sonic-fpv/src';
import { REPO } from '../src/evidence';

describe('Backslash switches Fly by Sound in any scene', () => {
    it('routes on an ordinary page (no ?sonic=), in flight and while crashed, with no conflict', () => {
        for (const state of ['flight', 'crash'] as const) expect(actionFor({ code: 'Backslash', shiftKey: false }, state)).toBe('flyBySound.toggle');
        expect(keymapProblems(KEYMAP)).toEqual([]);
    });
});

interface FakeHost {
    items: MenuItem[];
    keys: Map<string, (e: { repeat: boolean }) => void>;
    menu: { add(item: MenuItem): () => void };
}
function fakeHost(): FakeHost {
    const h: FakeHost = {
        items: [],
        keys: new Map(),
        menu: { add: (item) => { h.items.push(item); return () => { h.items = h.items.filter((i) => i !== item); }; } }
    };
    return h;
}
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('the pause item switches the mode here, the lessons stay a second item', () => {
    it('the item has no link (no new tab) and names the in-place key; a second item links the lessons', () => {
        const h = fakeHost();
        const ctx = { ...h, keys: { on: (a: string, run: (e: { repeat: boolean }) => void) => { h.keys.set(a, run); return () => h.keys.delete(a); } }, session: { scene: { id: '887f27aa' }, transform: { s: 1 } } };
        vi.stubGlobal('document', { documentElement: { lang: 'en' } });
        sonicFlight.install(ctx as never);
        const item = h.items.find((i) => i.id === 'pause.flyBySound');
        expect(item?.href).toBeUndefined();
        expect(item?.action).toBe('flyBySound.toggle');
        expect(h.items.find((i) => i.id === 'pause.flyBySoundLessons')?.href?.()).toMatch(/\/fly\/\?sonic=scan&scene=887f27aa&sz=1$/);
        expect(h.keys.has('flyBySound.toggle')).toBe(true);
        vi.unstubAllGlobals();
    });

    it('the key and the item toggle the same switch, loaded once; a held key does not repeat', async () => {
        const h = fakeHost();
        const host = { menu: h.menu, keys: { on: (a: string, run: (e: { repeat: boolean }) => void) => { h.keys.set(a, run); return () => h.keys.delete(a); } } };
        let loads = 0;
        const sw: HereSwitch & { presses: number } = { on: false, presses: 0, async toggle() { this.presses++; (this as { on: boolean }).on = !this.on; return this.on; } };
        const opened: string[] = [];
        const off = hereItems(host, async () => { loads++; return sw; }, () => '/en/fly/?sonic=start', (u) => opened.push(u));
        h.keys.get('flyBySound.toggle')?.({ repeat: false });
        await flush();
        expect(sw.on).toBe(true);
        h.keys.get('flyBySound.toggle')?.({ repeat: true });
        await flush();
        expect(sw.presses).toBe(1);
        h.items.find((i) => i.id === 'pause.flyBySound')?.run(true);
        await flush();
        expect(sw.on).toBe(false);
        expect(loads).toBe(1);
        h.items.find((i) => i.id === 'pause.flyBySoundLessons')?.run(true);
        expect(opened).toEqual(['/en/fly/?sonic=start']);
        off();
        expect(h.items).toEqual([]);
        expect(h.keys.size).toBe(0);
    });
});

describe('the switch: entry, introduction, off', () => {
    function deps(o: { first?: boolean; noSound?: boolean; installFails?: boolean } = {}) {
        const log: string[] = [];
        let entry: SonicEntry | null = null;
        let marked = false;
        const d: InPlaceDeps<{ id: string }> = {
            flown: () => ({ scene: { id: '70b50d42' }, transform: { s: 2, t: [0, 0, 0] } }),
            start: async () => (o.noSound ? null : { id: 'setup' }),
            stop: () => void log.push('stop'),
            setEntry: (e) => { entry = e; log.push(e ? 'entry' : 'no entry'); },
            install: async () => {
                if (o.installFails) throw new Error('chunk');
                log.push('installed');
                return () => void log.push('uninstalled');
            },
            firstTime: () => (o.first ?? false) && !marked,
            markFlies: () => { marked = true; },
            lessons: () => void log.push('lessons'),
            failed: () => void log.push('failed')
        };
        return { d, log, entry: () => entry };
    }

    it('on: the free flight of the scene flown, at its size, here, with Leave switching off; off: the mode out and the entry cleared', async () => {
        const { d, log, entry } = deps();
        const s = new InPlaceSwitch(d);
        expect(await s.toggle()).toBe(true);
        const e = entry() as SonicEntry;
        expect(e.lessonId).toBe(SCAN_FREE_ID);
        expect(e.here).toBe(true);
        expect(e.free?.world).toMatchObject({ kind: 'scan', sceneId: '70b50d42', transform: [2, 0, 0, 0], track: null });
        expect(e.intro).toBe(false);
        e.leave?.();
        expect(s.on).toBe(false);
        expect(entry()).toBeNull();
        expect(log).toEqual(['entry', 'installed', 'uninstalled', 'no entry', 'stop']);
    });

    it('a first-timer hears the introduction once: the second switch-on does not say it', async () => {
        const { d, entry } = deps({ first: true });
        const s = new InPlaceSwitch(d);
        await s.toggle();
        expect(entry()?.intro).toBe(true);
        await s.toggle();
        await s.toggle();
        expect(entry()?.intro).toBe(false);
        expect(firstTimer({}, false)).toBe(true);
        expect(firstTimer({ 'ears-1': {} }, false)).toBe(false);
        expect(firstTimer({}, true)).toBe(false);
    });

    it('no sound or a chunk that did not load: said, the entry stays clear, the flight goes on', async () => {
        for (const o of [{ noSound: true }, { installFails: true }]) {
            const { d, log, entry } = deps(o);
            const s = new InPlaceSwitch(d);
            expect(await s.toggle()).toBe(false);
            expect(entry()).toBeNull();
            expect(s.on).toBe(false);
            expect(log).toContain('failed');
        }
    });

    it('a built-in world gets the same free flight (any scene id, its own size)', () => {
        const l = freeHere({ scene: { id: 'builtin-gates' }, transform: { s: 1, t: [0, 0, 0] } });
        expect(l.id).toBe(SCAN_FREE_ID);
        expect(l.intro).toEqual([{ key: 'sonic.say.inPlaceOn' }]);
    });
});

// review SO-7: the failure line named the key in fixed words and only said "try again"; it names the pilot's own key (as the intro
// does) and, in a browser with no Web Audio, leads to the way that works (another browser) instead of a retry that cannot help
describe('the switch did not come up: the line leads on', () => {
    it('names the key by its cap in every language; no Web Audio: the other-browser line', () => {
        expect(failedLine(false, '\\')).toEqual({ key: 'sonic.menu.hereFailed', params: { key: '\\' } });
        expect(failedLine(true, '\\')).toEqual({ key: 'sonic.start.noAudio' });
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const d = JSON.parse(readFileSync(join(REPO, `packages/i18n/locales/fly/sonicentry/${lang}.json`), 'utf8')) as Record<string, string>;
            const s = d['sonic.menu.hereFailed'] ?? '';
            expect(s, lang).toContain('{key}');
            // the old fixed words of the four languages, the pl and ru ones by char codes: this file stays ASCII (gate B18)
            const fixed = ['backslash', 'barra invertida', `uko${String.fromCharCode(0x15b)}nik`, String.fromCharCode(0x43a, 0x43e, 0x441, 0x443, 0x44e)];
            expect(fixed.filter((w) => s.toLowerCase().includes(w)), lang).toEqual([]);
        }
    });
});

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

describe('the free flight opened in place keeps the craft where it is', () => {
    let rig: Rig | null = null;
    afterEach(() => {
        rig?.dispose();
        rig = null;
        vi.restoreAllMocks();
    });

    it('flown away from the spawn, then opened here: the craft stays there (control: opened as before, it goes back to the spawn)', async () => {
        const track = garden();
        const scan = scanOf(track);
        const free = scanFreeLesson('7a475d38', [5, 0, 0, 0]);
        const r = await Rig.make(free, { scan });
        rig = r;
        expect(await r.host.openFree(free)).toBe(true);
        // the intro first (the craft waits), then forward
        await r.run(60000, null, () => r.host.runner?.phase === 'flying');
        await r.run(6000, () => ({ forward: 1 }));
        const away = [...r.pos];
        const fromSpawn = (): number => Math.hypot(r.pos[0] - scan.spawn[0], r.pos[2] - scan.spawn[2]);
        expect(fromSpawn()).toBeGreaterThan(3);
        expect(await r.host.openFree(free, { here: true })).toBe(true);
        await r.run(500);
        expect(fromSpawn()).toBeGreaterThan(3);
        expect(Math.hypot(r.pos[0] - (away[0] as number), r.pos[2] - (away[2] as number))).toBeLessThan(3);
        // control: the same open without here puts the craft back at the scan's spawn
        expect(await r.host.openFree(free)).toBe(true);
        await r.run(500);
        expect(fromSpawn()).toBeLessThan(1);
    });

    // review SO-1: switching off (and on) in place started a new life (the lesson's bump LESSON_FLIGHT applied as a 'life' setting):
    // in the air the craft stopped dead, crashed it went to the scene's spawn. In place the flight keeps its own rules.
    it('switched off while flying: pose and velocity unchanged, no new life; switched off while crashed: the craft stays where it is', async () => {
        const track = garden();
        const scan = scanOf(track);
        const free = scanFreeLesson('7a475d38', [5, 0, 0, 0]);
        const r = await Rig.make(free, { scan });
        rig = r;
        let lives = 0;
        const onLife = r.session.onLife;
        r.session.onLife = (...a: Parameters<NonNullable<typeof onLife>>) => {
            lives++;
            onLife?.(...a);
        };
        expect(await r.host.openFree(free, { here: true })).toBe(true);
        expect(r.session.lifeOverrides().bump).toBeUndefined();
        await r.run(60000, null, () => r.host.runner?.phase === 'flying');
        await r.run(3000, () => ({ forward: 1 }));
        const s = r.session.sim.s;
        expect(s[S.hold]).toBe(0);
        expect(r.speed).toBeGreaterThan(1);
        const pos = [...r.pos];
        const vel = [...r.vel];
        const before = lives;
        r.mode.leave();
        expect(lives).toBe(before);
        expect(Math.hypot(r.pos[0] - (pos[0] as number), r.pos[1] - (pos[1] as number), r.pos[2] - (pos[2] as number))).toBeLessThan(0.1);
        expect(Math.hypot(r.vel[0] - (vel[0] as number), r.vel[1] - (vel[1] as number), r.vel[2] - (vel[2] as number))).toBeLessThan(0.01);
        // crashed: switched on again in place, then off with the craft down where it is
        expect(await r.host.openFree(free, { here: true })).toBe(true);
        await r.run(500);
        const at = [...r.pos];
        r.session.sim.s[S.crashed] = 1;
        r.mode.leave();
        expect(Math.hypot(r.pos[0] - (at[0] as number), r.pos[2] - (at[2] as number))).toBeLessThan(0.1);
        expect(Math.hypot(r.pos[0] - scan.spawn[0], r.pos[2] - scan.spawn[2])).toBeGreaterThan(1);
    });

    // review SO-1, found by the r11 life spy in the browser (y1-spy.json): the page's crash rule is a 'life' setting
    // (respawn.ts: setCrashOn, then applyLifeSettings), so the mode's crash.enabled false made a new life on the switch on and
    // its clear another on the switch off; and the runner's 'place' to the start (its begin, and the first attempt when the craft
    // left the start during the intro) took the respawn path. In place none of them may happen.
    it('with the page pref reaction wired: switched on and off in the air, no new life, the speed and the way flown kept', async () => {
        const track = garden();
        const scan = scanOf(track);
        const free = scanFreeLesson('7a475d38', [5, 0, 0, 0]);
        const r = await Rig.make(free, { scan });
        rig = r;
        // what respawn.ts does on the page when crash.enabled changes (the pilot's own setting: on)
        r.onPref = (id) => {
            if (id !== 'crash.enabled') return;
            const s = r.session;
            if (s.setCrashOn(r.sessionPrefs.get(id) !== false)) s.applyLifeSettings(s.presetId, s.overrides);
        };
        let lives = 0;
        const onLife = r.session.onLife;
        r.session.onLife = (...a: Parameters<NonNullable<typeof onLife>>) => {
            lives++;
            onLife?.(...a);
        };
        const respawns = vi.spyOn(r.session, 'respawnStart');
        const flyTo = async (): Promise<void> => {
            await r.run(60000, null, () => r.host.runner?.phase === 'flying');
            expect(r.host.runner?.phase).toBe('flying');
            await r.run(1500, () => ({ forward: 1 }));
            expect(r.speed).toBeGreaterThan(1);
        };
        expect(await r.host.openFree(free, { here: true })).toBe(true);
        await flyTo();
        // off in the air: the same tick, then the flight goes on
        const v1 = r.speed;
        r.mode.leave();
        await r.run(20);
        expect(lives).toBe(0);
        expect(r.speed).toBeGreaterThan(v1 / 2);
        // on again in the air
        const v2 = r.speed;
        expect(await r.host.openFree(free, { here: true })).toBe(true);
        await r.run(50, () => ({ forward: 1 }));
        expect(lives).toBe(0);
        expect(r.speed).toBeGreaterThan(v2 / 2);
        // flown on during the intro: the first attempt does not put the craft back where it was switched on
        await r.run(1500, () => ({ forward: 1 }));
        const flown = [...r.pos];
        await r.run(60000, null, () => r.host.runner?.phase === 'flying');
        expect(Math.hypot(r.pos[0] - (flown[0] as number), r.pos[2] - (flown[2] as number))).toBeLessThan(3);
        expect(respawns).not.toHaveBeenCalled();
        expect(lives).toBe(0);
    });
});
