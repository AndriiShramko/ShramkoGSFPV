// v0.12 v12-int step 6 (docs/wip/v12-int.md): "my screen reader speaks". With the engine's selfVoice off the engine says nothing and
// waits each line's time on its own, all the lines of a burst at once (packages/sonic-fpv src/audio/engine.ts say(): one timer per
// call), while a screen reader reads them one after the other; the host's queue (SonicBridge.say) emptied after the LONGEST line, so the
// lesson went on to its flying phase while the reader was still on the intro (flight review, D6 notes). In that mode the bridge now
// counts the lines one after the other (sequential, readTimeMs): the end of speech comes when the last line would have been read.
// The lesson rig (the real flight model, lesson pilot, mode, bridge, host and the package's runner) with its fake engine in the real
// engine's screen-reader behaviour (parallel waits). Controls: the old waits (no sequential queue) end at the longest line; a recording
// made in this mode still re-derives on replay (its speech.end markers are the host's), and without the markers it does not.
// v0.13 (lane v13-host A2, docs/wip/v13-host.md "Changed tests"): the task is said in parts, the lines up to a named sound, its
// plays, the rest (M41-5), so the intro test measures every part of the task up to the first attempt.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildManifest, checkSession, defaultPrefs, getBuiltinTheme, getLesson } from '../../../packages/sonic-fpv/src';
import type { FlightFrame, SessionEvent, SessionManifest } from '../../../packages/sonic-fpv/src';
import { estimateSpeechS } from '../../../packages/sonic-fpv/src/audio/speech';
import { Rig } from './sonic-lesson-rig';
import type { Control } from './sonic-lesson-rig';

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
    vi.restoreAllMocks();
});

const throughTheGate: Control = (r) => ({ forward: 1, lift: Math.max(-0.4, Math.min(0.4, (3 - r.pos[1]) * 0.8)) });
const readMs = (text: string): number => estimateSpeechS(text, 1) * 1000;

/** rings-first in a page whose engine waits as with "my screen reader speaks"; `queued`: the bridge counts the lines one after the other. */
async function readerPage(queued: boolean): Promise<Rig> {
    const r = await Rig.make(getLesson('rings-first'));
    r.engine.parallel = true;
    if (queued) {
        r.mode.bridge.sequential = () => true;
        r.mode.bridge.readTimeMs = readMs;
        r.mode.bridge.wait = (ms) => r.engine.wait(ms);
    }
    expect(await r.host.open('rings-first')).toBe(true);
    rig = r;
    return r;
}

const markers = (r: Rig): SessionEvent[] => r.sonic.filter((e) => e.kind === 'speech' && e.key === 'speech.end');

describe('"my screen reader speaks": the lesson waits for its lines read one after the other', () => {
    it('the task: the end of speech of each part comes after the sum of its lines, and the flying phase after the last part (not after the longest line)', async () => {
        const r = await readerPage(true);
        await r.run(120000, null, () => r.lessonEvents('attempt-start').length > 0);
        const off = r.clock.t - r.mode.bridge.now(); // the page's clock less the mode's
        const start = r.lessonEvents('attempt-start')[0]!.t;
        // the task's lines, in the parts they were handed over in (a part is said at once); a part ends where a line names a sound
        const task = r.engine.said.filter((s) => s.at - off < start);
        const parts = [...new Set(task.map((s) => s.at))].map((at) => task.filter((s) => s.at === at));
        const intro = getLesson('rings-first').intro;
        const named = intro.filter((l) => (l.cues?.length ?? 0) > 0).length;
        expect(parts).toHaveLength(named + ((intro.at(-1)!.cues?.length ?? 0) > 0 ? 0 : 1));
        const ends = markers(r).map((e) => e.t);
        let apart = 0;
        for (const part of parts) {
            const at = part[0]!.at - off;
            const sum = part.reduce((a, s) => a + readMs(s.text), 0);
            const end = ends.find((t) => t >= at)!;
            expect(end).toBeGreaterThanOrEqual(at + sum - 1);
            expect(end).toBeLessThan(at + sum + 40); // the frame that reaches it (16 ms) and the frame the part was handed in
            apart += sum - Math.max(...part.map((s) => readMs(s.text)));
        }
        expect(apart).toBeGreaterThan(1000); // the sums and the longest lines differ by seconds: the test can tell them apart
        expect(start).toBeGreaterThanOrEqual(ends.filter((t) => t <= start).at(-1)!);
        expect(ends.filter((t) => t <= start)).toHaveLength(parts.length);
    }, 120000);

    it('control: with the engine\'s own waits (the code before this step) the end of speech comes after the longest line only', async () => {
        const r = await readerPage(false);
        await r.run(60000, null, () => markers(r).length > 0);
        const intro = r.engine.said.filter((s) => s.at === r.engine.said[0]!.at);
        const longest = Math.max(...intro.map((s) => readMs(s.text)));
        const sum = intro.reduce((a, s) => a + readMs(s.text), 0);
        const end = markers(r)[0]!.t;
        expect(end).toBeLessThan(longest + 40);
        expect(end).toBeLessThan(sum - 1000);
    }, 120000);

    it('a line of the lesson that interrupts (Z, N: the runner\'s own) cuts what is being read: the end of speech comes after it alone', async () => {
        const r = await readerPage(true);
        await r.run(300, null);
        const n0 = markers(r).length;
        const before = r.clock.t;
        // (v13-int review F1: the lesson's own line, as the runner says Z's and N's; a host line's cut, I's, is the next test's)
        void r.mode.bridge.say({ key: 'status.none' }, true, { lesson: true });
        await r.run(20000, null, () => markers(r).length > n0);
        const end = markers(r).at(-1)!.t;
        const own = readMs(r.engine.said.find((x) => x.line.key === 'status.none')!.text); // (the lesson says its next line after the marker)
        // measured on the mode's clock: the marker is the interrupting line's own time after it, not the rest of the intro
        const at = before - (r.clock.t - r.mode.bridge.now());
        expect(end - at).toBeGreaterThanOrEqual(own - 1);
        expect(end - at).toBeLessThan(own + 40);
    }, 120000);

    it('v13-int review F1: a host line that interrupts (I) cuts what is being read, and the lesson\'s lines it cut are read again after it: the end of speech comes after them', async () => {
        const r = await readerPage(true);
        await r.run(300, null);
        const n0 = markers(r).length;
        const cut = r.engine.said.map((s) => s.line.key);
        void r.mode.bridge.say({ key: 'status.none' }, true);
        await r.run(60000, null, () => markers(r).length > n0);
        const again = r.engine.said.slice(cut.length + 1).map((s) => s.line.key);
        // the lesson's lines handed before I, handed again after it, in order (the reader reads them after I's line)
        expect(again.slice(0, cut.length)).toEqual(cut);
        const end = markers(r).at(-1)!.t;
        const own = readMs(r.engine.said.find((x) => x.line.key === 'status.none')!.text);
        const lines = r.engine.said.slice(cut.length + 1, 2 * cut.length + 1).reduce((a, s) => a + readMs(s.text), 0);
        const at = r.engine.said.find((x) => x.line.key === 'status.none')!.at - (r.clock.t - r.mode.bridge.now());
        expect(end - at).toBeGreaterThanOrEqual(own + lines - 40);
    }, 120000);

    it('a lesson flown in this mode re-derives on replay: every event, the markers the host wrote; control: without them it does not', async () => {
        const r = await readerPage(true);
        const frames: FlightFrame[] = [];
        let n = 0;
        const record: Control = (rr) => {
            const s = rr.last;
            if (s && rr.engine.lastInput && ++n % 2 === 0 && !s.paused) frames.push({ t: s.t, tick: s.tick, p: s.pos, v: s.vel, q: s.quat, s: s.sticks, c: rr.engine.activeCues().map((c) => c.id) });
            return throughTheGate(rr);
        };
        // N in the task (it skips the rest of the task: the first attempt begins at the key, which only the key event re-derives); since
        // v0.13 stage B (B2) N while flying leaves the lesson and the host opens the next one, so it is pressed before the flight
        await r.run(1200, record);
        r.mode.next('KeyN');
        await r.run(80000, record, () => r.lessonEvents('attempt-start').length >= 3);
        await r.run(3000, record);
        await r.run(600, record);
        expect(r.lessonEvents('open').map((e) => e.lessonId)).toEqual(['rings-first']);
        expect(r.of('key').map((e) => e.action)).toEqual(['next']);
        const manifest = buildManifest({
            id: 'readerSession0000001',
            created: '2026-11-07T10:00:00Z',
            app: { name: 'ShramkoGSFPV', release: 'test', sonic: 'test' },
            scene: { kind: 'analytic', id: r.world.id, version: r.world.version, transform: [1, 0, 0, 0] },
            lesson: { id: 'rings-first', version: 1, path: 'full' },
            theme: { id: 'soft', version: getBuiltinTheme('soft').version },
            settings: { ...defaultPrefs(), selfVoice: false },
            assists: getLesson('rings-first').assists,
            device: { userAgent: 'vitest', locale: 'en', audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, headphones: 'wired', gpu: null },
            consent: { recording: true, voice: false, send: false, speechRecognition: false, minor: false, guardianConfirmed: null, at: '2026-11-07T10:00:00Z' },
            pilot: { id: 'testPilot01', nickname: null },
            clock: { startIso: '2026-11-07T10:00:00Z', frameHz: 30 }
        }) as SessionManifest;
        expect(markers(r).length).toBeGreaterThanOrEqual(3);
        const { check } = checkSession({ manifest, frames, events: r.sonic });
        expect(check.events.diffs).toEqual([]);
        expect(check.events.matched).toBe(check.events.recorded);
        expect(check.events.recorded).toBeGreaterThan(10);
        const bare = checkSession({ manifest, frames, events: r.sonic.filter((e) => !(e.kind === 'speech' && e.key === 'speech.end')) });
        expect(bare.check.events.diffs.length).toBeGreaterThan(0);
    }, 300000);
});
