// Train 3, lane quiet, stage fixes (review QV-1, QV-2, QV-4): with the narrator off a flight says no line, and every event that was
// told in words keeps a sound (apps/fly/src/app/quiet-cues.ts). Two speakers reach the engine: the bridge (the runner's and the
// host's lines) and sayVia (the course made by Shift+G, the walls, the rooms, the recorder). Both must send a line quiet and play
// its sound in its place; neither may do it with the narrator on.
import { afterEach, describe, expect, it } from 'vitest';
import { analyticCollision } from '../../../packages/collision/src';
import { scanFreeLesson } from '../../../packages/sonic-fpv/src';
import type { CueEvent, SonicRuntime, SpeechLine } from '../../../packages/sonic-fpv/src';
import { sayVia } from '../../../apps/fly/src/app/say-via';
import { NARRATOR_OFF_CUE, QUIET_SOUNDS, quietCue } from '../../../apps/fly/src/sonic/quiet-cues';

const COURSE_READY_CUE: CueEvent = { kind: 'checkpoint' };
import { PageRuntime } from '../../../apps/fly/src/sonic/runtime';
import { Rig } from './sonic-lesson-rig';
import type { RigScan } from './sonic-lesson-rig';

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
});

interface Said {
    readonly line: SpeechLine;
    readonly o: { readonly interrupt?: boolean; readonly quiet?: boolean } | undefined;
}

/** A runtime with a recording engine; `quiet` as PageRuntime answers it (or absent: an older runtime). */
function fakeRuntime(quiet: (() => boolean) | null): { rt: SonicRuntime; said: Said[]; cues: CueEvent[] } {
    const said: Said[] = [];
    const cues: CueEvent[] = [];
    const engine = {
        say: (line: SpeechLine, o?: { readonly interrupt?: boolean; readonly quiet?: boolean }) => {
            said.push({ line, o });
            return Promise.resolve();
        },
        cue: (e: CueEvent) => void cues.push(e)
    };
    const rt = { engine, ...(quiet ? { quiet, quietSound: quietCue } : {}) } as unknown as SonicRuntime;
    return { rt, said, cues };
}

describe('sayVia keeps the narrator setting (QV-1)', () => {
    it('narrator off in a flight: the line goes to the engine quiet and its sound plays instead', async () => {
        const { rt, said, cues } = fakeRuntime(() => true);
        const speak = sayVia(() => rt);
        await speak({ key: 'sonic.say.wallsIn' });
        await speak({ key: 'sonic.say.text', params: { text: 'Course ready' } }, { quietCue: COURSE_READY_CUE });
        await speak({ key: 'sonic.say.text', params: { text: 'Making the course, 40 percent' } });
        expect(said.map((s) => s.o?.quiet === true)).toEqual([true, true, true]);
        expect(cues).toEqual([{ kind: 'checkpoint' }, COURSE_READY_CUE]);
    });

    it('narrator on, or a runtime that cannot tell: voiced as before and no sound added', async () => {
        for (const q of [() => false, null]) {
            const { rt, said, cues } = fakeRuntime(q);
            await sayVia(() => rt)({ key: 'sonic.say.wallsIn' }, { interrupt: true, quietCue: COURSE_READY_CUE });
            expect(said.map((s) => s.o?.quiet === true)).toEqual([false]);
            expect(said[0]?.o?.interrupt).toBe(true);
            expect(cues).toEqual([]);
        }
    });

    it("the page's runtime answers with the bridge's predicate, read at each line", () => {
        let on = false;
        const mode = { bridge: { quiet: () => on } };
        const rt = new PageRuntime({} as never, mode as never);
        expect(rt.quiet()).toBe(false);
        on = true;
        expect(rt.quiet()).toBe(true);
        expect(new PageRuntime({} as never, { bridge: { quiet: null } } as never).quiet()).toBe(false);
    });
});

describe('the bridge plays the sound of a quiet line (QV-2)', () => {
    async function flight(quiet: () => boolean): Promise<Rig> {
        const collision = analyticCollision([-40, -1, -80], [40, 14, 80], 0.25, (_x, y) => y < 0);
        const scan: RigScan = { sceneId: '7a475d38', collision, sha256: 'flat-floor', track: null as never, transform: [1, 0, 0, 0], spawn: [0, 2, 0, 0] };
        const free = scanFreeLesson('7a475d38', [1, 0, 0, 0]);
        const r = await Rig.make(free, { scan });
        rig = r;
        r.mode.bridge.quiet = quiet;
        expect(await r.host.openFree(free)).toBe(true);
        return r;
    }

    it('narrator off: gate behind, a put back and the mode on each play their sound; a line whose cue is sent with it adds none', async () => {
        const r = await flight(() => true);
        r.engine.cues.length = 0;
        await r.mode.bridge.say({ key: 'sonic.say.gateBehind' }, false, { lesson: true });
        await r.mode.bridge.say({ key: 'fly.reset-start' });
        await r.mode.bridge.say({ key: 'sonic.say.inPlaceOn' });
        await r.mode.bridge.say({ key: 'fly.wrong-way' });
        expect(r.engine.cues.map((c) => c.kind)).toEqual(['wrong-side', 'reset', 'answer']);
    }, 60000);

    it('narrator on: the same lines are spoken and add no sound', async () => {
        const r = await flight(() => false);
        r.engine.cues.length = 0;
        // voiced lines take their time on the rig's clock: not awaited, the sound would be played at the call
        void r.mode.bridge.say({ key: 'sonic.say.gateBehind' }, false, { lesson: true });
        void r.mode.bridge.say({ key: 'fly.reset-start' });
        expect(r.engine.cues).toEqual([]);
        expect(r.engine.said.slice(-2).map((s) => [s.line.key, s.quiet === true])).toEqual([['sonic.say.gateBehind', false], ['fly.reset-start', false]]);
    }, 60000);
});

describe('the table (Q3)', () => {
    it('every line has a sound or a reason; the narrator off sound is none of the course sounds (QV-4)', () => {
        for (const [key, s] of Object.entries(QUIET_SOUNDS)) {
            expect(s.cue !== null || s.why.length > 10, key).toBe(true);
        }
        expect(quietCue('no.such.line')).toBeNull();
        const courseKinds = new Set(['checkpoint', 'gate', 'lap', 'fanfare', 'stage', 'wrong-side', 'wrong-way', 'reset']);
        expect(courseKinds.has(NARRATOR_OFF_CUE.kind)).toBe(false);
        expect(NARRATOR_OFF_CUE).not.toEqual(QUIET_SOUNDS['sonic.say.inPlaceOn']?.cue);
    });
});
