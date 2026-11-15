// Lane quiet, stage K1 (train 3, the owner's message 54: "I just want to open a scan and fly ... without the extra talk"):
// Q1 the narrator off is "sounds only" in a flight: no line voiced, none to a screen reader, none waited for; the lessons of the
// lesson list keep their words. Q2 nothing in a flight waits for a line: the free flight's task is said over the flight and what
// the pilot flew meanwhile is not undone, with the narrator on, with "my screen reader speaks" and with the narrator off.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyticCollision } from '../../../packages/collision/src';
import { defaultPrefs, scanFreeLesson, SCAN_FREE_ID } from '../../../packages/sonic-fpv/src';
import type { SonicPrefs, Vec3 } from '../../../packages/sonic-fpv/src';
import { estimateSpeechS } from '../../../packages/sonic-fpv/src/audio/speech';
import { quietFlight } from '../../../apps/fly/src/sonic/entry';
import { runnerOptions } from '../../../apps/fly/src/sonic/lessons';
import { Rig } from './sonic-lesson-rig';
import type { Control, RigScan } from './sonic-lesson-rig';

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
    vi.restoreAllMocks();
});

type Setting = 'narrator' | 'reader' | 'off';
const forward: Control = (r) => ({ forward: 1, lift: Math.max(-0.4, Math.min(0.4, (2 - r.pos[1]) * 0.8)) });

/** The free flight over a flat scan, opened on the sound page (not in place), in one of the three settings. */
async function freeFlight(setting: Setting): Promise<{ r: Rig; prefs: { value: SonicPrefs } }> {
    const collision = analyticCollision([-40, -1, -80], [40, 14, 80], 0.25, (_x, y) => y < 0);
    const scan: RigScan = { sceneId: '7a475d38', collision, sha256: 'flat-floor', track: null as never, transform: [1, 0, 0, 0], spawn: [0, 2, 0, 0] };
    const free = scanFreeLesson('7a475d38', [1, 0, 0, 0]);
    const r = await Rig.make(free, { scan });
    rig = r;
    const prefs = { value: { ...defaultPrefs(), selfVoice: setting !== 'reader' && setting !== 'off' ? true : false, narrator: setting !== 'off' } };
    // as feature.ts wires the page: the reader's lines one after the other, the narrator read at every line
    r.engine.parallel = setting !== 'narrator';
    if (!prefs.value.selfVoice) {
        r.mode.bridge.sequential = () => !prefs.value.selfVoice;
        r.mode.bridge.readTimeMs = (text) => estimateSpeechS(text, 1) * 1000;
        r.mode.bridge.wait = (ms) => r.engine.wait(ms);
    }
    r.mode.bridge.quiet = () => quietFlight(prefs.value, r.host.lesson?.id ?? null, r.mode.bridge.paused);
    expect(await r.host.openFree(free)).toBe(true);
    return { r, prefs };
}

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('Q1: the narrator off is sounds only in a flight', () => {
    it('no line is voiced or waited for: every line goes to the engine quiet, the task is over at once', async () => {
        const { r } = await freeFlight('off');
        await r.run(3000, forward);
        expect(r.engine.said.length).toBeGreaterThan(0);
        expect(r.engine.said.filter((s) => s.quiet !== true).map((s) => s.line.key)).toEqual([]);
        expect(r.host.runner?.phase).toBe('flying');
    }, 60000);

    it('applies at once: switched on in the flight, the next line is voiced; switched off again, quiet', async () => {
        const { r, prefs } = await freeFlight('off');
        await r.run(500, forward);
        prefs.value = { ...prefs.value, narrator: true };
        void r.mode.bridge.say({ key: 'status.none' });
        prefs.value = { ...prefs.value, narrator: false };
        void r.mode.bridge.say({ key: 'status.none' });
        const two = r.engine.said.filter((s) => s.line.key === 'status.none');
        expect(two.map((s) => s.quiet === true)).toEqual([false, true]);
    }, 60000);

    it('only a flight is quiet: a lesson of the lesson list and the paused menus keep their words; the narrator on is never quiet', () => {
        const off = { ...defaultPrefs(), narrator: false };
        expect(quietFlight(off, SCAN_FREE_ID, false)).toBe(true);
        expect(quietFlight(off, 'rings-first', false)).toBe(false);
        expect(quietFlight(off, null, false)).toBe(false);
        expect(quietFlight(off, SCAN_FREE_ID, true)).toBe(false);
        expect(quietFlight(defaultPrefs(), SCAN_FREE_ID, false)).toBe(false);
        const old: Partial<SonicPrefs> = { ...defaultPrefs() };
        delete (old as { narrator?: boolean }).narrator;
        expect(quietFlight(old as SonicPrefs, SCAN_FREE_ID, false)).toBe(false);
    });
});

describe('Q2: no flight waits for a line', () => {
    for (const setting of ['narrator', 'reader', 'off'] as const) {
        it(`${setting}: the craft flies from the first frame and nothing flown while the task is said is undone`, async () => {
            const { r } = await freeFlight(setting);
            const p0 = r.pos;
            await r.run(1000, forward);
            expect(dist(r.pos, p0)).toBeGreaterThan(0.5); // the sticks answer within the first second
            let last = r.pos;
            let jump = 0;
            for (let i = 0; i < 400 && r.host.runner?.phase !== 'flying'; i++) {
                await r.run(100, forward);
                jump = Math.max(jump, dist(r.pos, last));
                last = r.pos;
            }
            await r.run(500, forward);
            jump = Math.max(jump, dist(r.pos, last));
            expect(r.host.runner?.phase).toBe('flying');
            expect(r.sonic.filter((e) => e.kind === 'reset')).toEqual([]);
            expect(jump).toBeLessThan(2); // no place back to the start (5 m/s at most: 0.5 m a step)
        }, 120000);
    }

    it('the free flight asks the runner for a free start; a lesson of the list does not', () => {
        const page = { locale: 'en' as const, store: null as never, path: () => 'full' as const };
        const place = { start: { pos: [0, 1, 0] as Vec3, yawDeg: 0 }, floorY: 0, returnTo: null };
        expect(runnerOptions(page, SCAN_FREE_ID, place, 0).freeFlight).toBe(true);
        expect(runnerOptions({ ...page, store: { get: () => undefined, set: () => undefined } as never }, 'rings-first', place, 0).freeFlight).toBeUndefined();
    });
});
