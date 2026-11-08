// v0.13 Fly by Sound, lane v13-host stage B (docs/wip/v13-host.md "Stage B"): the pilot's keys and the lesson menu, in the page
// around the sound package's lesson runner. The lesson rig (tools/bench/test/sonic-lesson-rig.ts: the real flight model, lesson
// pilot, mode, bridge, lesson host and runner; a fake engine and drawing) and plain fakes where the rig has none.
//  - B1 (W3): the runner is made with the pilot's path, the names of his keys (as his keyboard layout types them), his speaking
//    speed and the lesson G left (createLessonRunner's path, keys, speechRate, returnTo).
//  - B2 (W4): the runner's 'go' action: 'next' is the host's way on after a pass (the lesson G left, else the next on the path),
//    'previous' the way back (the lesson G left, else the lesson before on the path, else the start screen); one move per runner.
//  - B3 (W5, M41-6): N, B and Z call the runner (next, previous, repeat), each written first as a key event with its replay action,
//    so a recording with them replays PASS; in a lesson the mode's keys win over the page's (B is the feedback form's elsewhere).
//  - B4 (W6, M41-7): I says the runner's status line through the mode's voice; a large high-contrast panel draws the runner's view
//    after every attempt (the panel on a small stand-in for the DOM, tools/bench/test/sonic-fake-dom.ts).
//  - B5 (W8): the runner pauses and resumes with the flight, where the session's pause and resume are written; no end of speech
//    while paused, once after the resume; a question does not time out in a pause, and a paused session replays PASS.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASK_TIMEOUT_S, REPEAT_PLAYS, REPLAY_KEY_ACTIONS, SPEECH_END_KEY, buildManifest, checkSession, defaultPrefs, getBuiltinTheme, getLesson, lessonAfter, lessonBefore, lessonPaths } from '../../../packages/sonic-fpv/src';
import type { FlightFrame, LessonSession, LessonView, SessionEvent } from '../../../packages/sonic-fpv/src';
import { KEYMAP } from '../../../packages/prefs/src/keymap';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import { STATUS_ORDER, StatusBoard, sayStatus } from '../../../apps/fly/src/app/sonic-status';
import { DEFAULT_RUNNER_KEYS, KeyNames, codeOfHint, spokenKey } from '../../../apps/fly/src/sonic/key-names';
import { runnerOptions } from '../../../apps/fly/src/sonic/lessons';
import { ProgressPanel, followProgress, progressRows } from '../../../apps/fly/src/sonic/progress-panel';
import { saveProgress } from '../../../apps/fly/src/sonic/store';
import { REPO, mkStore } from '../../../packages/prefs/test/helpers';
import { FakeDocument } from './sonic-fake-dom';
import { Rig } from './sonic-lesson-rig';
import type { Control } from './sonic-lesson-rig';

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
    vi.restoreAllMocks();
});

async function open(id: string, before?: (r: Rig) => void): Promise<Rig> {
    rig = await Rig.make(getLesson(id));
    before?.(rig);
    expect(await rig.host.open(id)).toBe(true);
    return rig;
}

/** A call into the runner as the bridge makes one (its events out on the bus, then the host takes the runner's actions). */
function call(r: Rig, f: (run: LessonSession, t: number) => readonly SessionEvent[]): void {
    r.mode.bridge.events(f(r.host.runner!, r.mode.bridge.now()));
    r.mode.bridge.afterRunner?.();
}

const opens = (r: Rig): string[] => r.lessonEvents('open').map((e) => e.lessonId);

/** The key names of a page entered through ?sonic= (or not): its router's key table, Escape said by its name. */
function pageNames(sonic = true): KeyNames {
    const router = new KeyRouter({ map: KEYMAP, sonic: () => sonic });
    return new KeyNames((a) => router.caps(a), (code) => (code === 'Escape' ? 'Escape' : null));
}

// ------------------------------------------------------------------ B1

describe('B1 (W3): the runner gets the pilot\'s path, key names, speaking speed and the way back of G', () => {
    it('the names of the keys: N, B and Z from the page\'s key table, Escape by its name; with the pilot\'s layout, what it types on each place', () => {
        const names = pageNames();
        expect(names.runner()).toEqual({ next: 'N', previous: 'B', repeat: 'Z' });
        expect(names.of('pause.toggle', 'Escape')).toBe('Escape');
        expect(names.of('pause.toggle')).toBe('Escape P');
        // a German keyboard types Y on the place of Z (KeyboardLayoutMap gives lower-case characters by code)
        names.setLayout(new Map([['KeyZ', 'y'], ['KeyY', 'z'], ['KeyN', 'n'], ['KeyB', 'b']]));
        expect(names.runner()).toEqual({ next: 'N', previous: 'B', repeat: 'Y' });
        // a French one W
        names.setLayout(new Map([['KeyZ', 'w'], ['KeyW', 'z'], ['KeyQ', 'a'], ['KeyN', 'n'], ['KeyB', 'b']]));
        expect(names.runner().repeat).toBe('W');
        // a place the layout types nothing printable on keeps the table's cap; a named key never takes a layout's character
        names.setLayout(new Map([['KeyZ', ' '], ['Escape', 'x']]));
        expect(names.runner().repeat).toBe('Z');
        expect(names.of('pause.toggle', 'Escape')).toBe('Escape');
        expect(codeOfHint({ cap: 'Shift+N', aria: 'Shift+N' })).toBeNull();
        expect(spokenKey({ cap: '[', aria: '[' }, new Map([['BracketLeft', 'ü']]), () => null)).toBe('[');
    });

    it('the layout is asked of the browser (navigator.keyboard.getLayoutMap) when it has it; without it, or when it refuses, the caps', async () => {
        const names = pageNames();
        await names.refresh({ keyboard: { getLayoutMap: async () => new Map([['KeyZ', 'y']]) } });
        expect(names.runner().repeat).toBe('Y');
        const plain = pageNames();
        await plain.refresh({});
        expect(plain.runner().repeat).toBe('Z');
        const refused = pageNames();
        await refused.refresh({ keyboard: { getLayoutMap: () => Promise.reject(new Error('SecurityError')) } });
        expect(refused.runner().repeat).toBe('Z');
    });

    it('control: on a page without the mode its own key Z has no cap (not routed there), so the runner keeps its own name', () => {
        const names = pageNames(false);
        expect(names.of('sonic.repeat')).toBe('');
        expect(names.runner()).toEqual({ next: 'N', previous: 'B', repeat: DEFAULT_RUNNER_KEYS.repeat });
    });

    it('runnerOptions: the path, the key names and the speaking speed are the page\'s, the way back the opener\'s, the progress the store\'s', () => {
        const store = mkStore();
        saveProgress(store, { lessonId: 'rings-first', version: getLesson('rings-first').version, attempts: 2, successes: 1, blocksPassed: 0, passed: false, bestTimeMs: null, lastAt: '2026-11-08T10:00:00.000Z' });
        const page = { locale: 'en' as const, store, path: () => 'fast' as const, keyNames: () => ({ next: 'J', previous: 'X', repeat: 'Y' }), speechRate: () => 1.5 };
        const start = getLesson('rings-first').start;
        const o = runnerOptions(page, 'rings-first', { start, floorY: 0, objects: null, returnTo: 'hover-height' }, 5);
        expect(o).toMatchObject({ locale: 'en', path: 'fast', keys: { next: 'J', previous: 'X', repeat: 'Y' }, speechRate: 1.5, returnTo: 'hover-height', sessionStartMs: 5, start, floorY: 0 });
        expect(o.progress).toMatchObject({ lessonId: 'rings-first', attempts: 2, successes: 1 });
        expect('objects' in o).toBe(false);
        // a page that gives no names and no speed: the runner's own names, speed 1
        const bare = runnerOptions({ locale: 'en', store, path: () => 'full' }, 'rings-first', { start, floorY: 0, objects: null, returnTo: null }, 0);
        expect(bare).toMatchObject({ path: 'full', speechRate: 1, returnTo: null });
        expect('keys' in bare).toBe(false);
    });

    it('in the page the lesson stands where it is on the pilot\'s path: rings-first is lesson 6 of 8 on the fast path, 20 of 28 on the full one', async () => {
        const paths = lessonPaths();
        const fast = await open('rings-first', (r) => { r.paths = 'fast'; });
        expect(fast.host.runner!.view()).toMatchObject({ path: 'fast', lessonIndex: paths.fast.indexOf('rings-first') + 1, lessonCount: paths.fast.length });
        expect(fast.host.runner!.view().lessonCount).toBe(8);
        fast.dispose();
        rig = null;
        const full = await open('rings-first');
        expect(full.host.runner!.view()).toMatchObject({ path: 'full', lessonIndex: paths.full.indexOf('rings-first') + 1, lessonCount: 28 });
    }, 60000);

    it('the names reach the lesson\'s lines: after three failed attempts in a row hover-height offers the next lesson under the name the page gives N', async () => {
        const r = await open('hover-height', (rr) => { rr.keyNames = { next: 'J', previous: 'X', repeat: 'Y' }; });
        // a pilot who never touches a stick: every attempt runs out
        await r.run(400000, null, () => r.engine.said.some((s) => s.line.key === 'fly.offer-next'));
        const offer = r.engine.said.find((s) => s.line.key === 'fly.offer-next');
        expect(offer, 'the go-on offer after three failures in a row').toBeDefined();
        expect(offer!.line.params).toMatchObject({ key: 'J' });
        expect(offer!.text).toContain('J');
        expect(r.lessonEvents('attempt-fail').length).toBeGreaterThanOrEqual(getLesson('hover-height').pass.attempts);
    }, 300000);
});

// ------------------------------------------------------------------ B2

/** Straight ahead at a gate's height (the rings and the squares of modules 5 and 6). */
const throughTheGate: Control = (r) => ({ forward: 1, lift: Math.max(-0.4, Math.min(0.4, (3 - r.pos[1]) * 0.8)) });

describe('B2 (W4): the runner\'s \'go\': on, back, the way back of G, and one move per runner', () => {
    it('N while flying moves on to the next lesson on the pilot\'s path (it was a dead end): the lesson left is marked skipped, opened once', async () => {
        const r = await open('rings-first');
        await r.run(240000, null, () => r.host.runner!.phase === 'flying');
        const left = r.host.runner!;
        r.mode.next('KeyN');
        await r.run(60000, null, () => r.host.lesson?.id !== 'rings-first');
        const next = lessonAfter('rings-first', 'full')!.id;
        expect(next).toBe('rings-line');
        expect(r.host.lesson!.id).toBe(next);
        expect(opens(r)).toEqual(['rings-first', next]);
        expect(r.lessonEvents('leave').map((e) => e.lessonId)).toEqual(['rings-first']);
        expect(left.progress().skipped).toBe(true);
        await r.run(3000, null);
        expect(opens(r)).toEqual(['rings-first', next]);
        expect(r.menus).toBe(0);
    }, 300000);

    it('B in a lesson\'s first step opens the lesson before on the path (rings-line: rings-first)', async () => {
        const r = await open('rings-line');
        expect(r.host.runner!.phase).toBe('intro');
        call(r, (run, t) => run.previous(t));
        await r.run(60000, null, () => r.host.lesson?.id !== 'rings-line');
        expect(lessonBefore('rings-line', 'full')!.id).toBe('rings-first');
        expect(r.host.lesson!.id).toBe('rings-first');
        expect(opens(r)).toEqual(['rings-line', 'rings-first']);
        expect(r.menus).toBe(0);
    }, 300000);

    it('B in the first lesson of the path has nothing before it: the start screen', async () => {
        const r = await open('ears-headphones');
        call(r, (run, t) => run.previous(t));
        await r.run(2000, null);
        expect(lessonBefore('ears-headphones', 'full')).toBeNull();
        expect(r.menus).toBe(1);
        expect(opens(r)).toEqual(['ears-headphones']);
    }, 120000);

    it('B in the glossary opened by G goes back to the lesson G left, not to the lesson before the glossary on the ladder', async () => {
        const r = await open('rings-first');
        await r.run(2000, null);
        expect(await r.host.glossary()).toBe(true);
        call(r, (run, t) => run.previous(t));
        await r.run(60000, null, () => r.host.lesson?.id !== 'ears-glossary');
        expect(lessonBefore('ears-glossary', 'full')!.id).toBe('ears-headphones');
        expect(r.host.lesson!.id).toBe('rings-first');
        expect(opens(r)).toEqual(['rings-first', 'ears-glossary', 'rings-first']);
    }, 300000);

    it('one move per runner: N after the pass, while the host is already opening the next lesson, opens nothing over it (no start screen, no second lesson)', async () => {
        const r = await open('shapes-square');
        await r.run(600000, throughTheGate, () => r.passed);
        expect(r.passed).toBe(true);
        // the host's own move after the pass swaps the walls for shapes-series; the pilot presses N meanwhile (the passed lesson's runner)
        let pressed = 0;
        r.onSwap = () => {
            if (r.host.lesson?.id !== 'shapes-square') return;
            pressed++;
            r.mode.next('KeyN');
        };
        await r.run(60000, null, () => r.host.lesson?.id !== 'shapes-square');
        await r.run(5000, null);
        expect(pressed).toBe(1);
        expect(r.lessonEvents('leave').map((e) => e.lessonId)).toEqual(['shapes-square']);
        expect(r.host.lesson!.id).toBe('shapes-series');
        expect(opens(r)).toEqual(['shapes-square', 'shapes-series']);
        expect(r.menus).toBe(0);
    }, 300000);
});

// ------------------------------------------------------------------ B3

/** A frame recorder as the recorder keeps them (every second frame of the page, not while paused), around a pilot. */
function recorder(pilot: Control | null): { frames: FlightFrame[]; control: Control } {
    const frames: FlightFrame[] = [];
    let n = 0;
    return {
        frames,
        control: (rr) => {
            const s = rr.last;
            if (s && rr.engine.lastInput && ++n % 2 === 0 && !s.paused) frames.push({ t: s.t, tick: s.tick, p: s.pos, v: s.vel, q: s.quat, s: s.sticks, c: rr.engine.activeCues().map((c) => c.id) });
            return pilot ? pilot(rr) : null;
        }
    };
}

/** The manifest of a recording of `lessonId` flown in the rig's world. */
function manifestOf(r: Rig, lessonId: string, id: string): ReturnType<typeof buildManifest> {
    return buildManifest({
        id,
        created: '2026-11-08T10:00:00Z',
        app: { name: 'ShramkoGSFPV', release: 'test', sonic: 'test' },
        scene: { kind: 'analytic', id: r.world.id, version: r.world.version, transform: [1, 0, 0, 0] },
        lesson: { id: lessonId, version: getLesson(lessonId).version, path: 'full' },
        theme: { id: 'soft', version: getBuiltinTheme('soft').version },
        settings: defaultPrefs(),
        assists: getLesson(lessonId).assists,
        device: { userAgent: 'vitest', locale: 'en', audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, headphones: 'wired', gpu: null },
        consent: { recording: true, voice: false, send: false, speechRecognition: false, minor: false, guardianConfirmed: null, at: '2026-11-08T10:00:00Z' },
        pilot: { id: 'testPilot01', nickname: null },
        clock: { startIso: '2026-11-08T10:00:00Z', frameHz: 30 }
    });
}

/** Presses an action's key as the page's router does (the last handler); the events the press wrote. */
function pressed(r: Rig, action: string, o: { repeat?: boolean } = {}): SessionEvent[] {
    const n = r.sonic.length;
    expect(r.press(action, o)).toBe(true);
    return r.sonic.slice(n);
}

describe('B3 (W5, M41-6): N, B and Z call the runner, each recorded first as a key the replay reads; in a lesson the mode\'s keys win', () => {
    it('N, B and Z: the key event (its replay action) is the first event of the press, the runner\'s follow; a held key\'s repeats do nothing', async () => {
        const r = await open('rings-first');
        const n = pressed(r, 'scene.next');
        expect(n[0]).toMatchObject({ kind: 'key', code: 'KeyN', action: REPLAY_KEY_ACTIONS.next });
        // N in the task: the first attempt begins at the key
        expect(n.slice(1).some((e) => e.kind === 'lesson' && e.what === 'attempt-start')).toBe(true);
        // the pilot waits on the start (straight on, the ring 5.5 m ahead ends the attempt within two seconds)
        await r.run(1500, null);
        expect(r.host.runner!.phase).toBe('flying');
        const z = pressed(r, 'sonic.repeat');
        expect(z[0]).toMatchObject({ kind: 'key', code: 'KeyZ', action: REPLAY_KEY_ACTIONS.repeat });
        expect(r.host.runner!.view().listening).toBe(true);
        const b = pressed(r, 'feedback.open');
        expect(b[0]).toMatchObject({ kind: 'key', code: 'KeyB', action: REPLAY_KEY_ACTIONS.previous });
        expect(r.host.runner!.phase).toBe('intro');
        for (const a of ['scene.next', 'feedback.open', 'sonic.repeat']) expect(pressed(r, a, { repeat: true }), a).toEqual([]);
    }, 120000);

    it('Z while flying: the whole task again, its title, every line and its named sound REPEAT_PLAYS times, the attempt waiting; then "Go on." (not the last line)', async () => {
        const r = await open('rings-first');
        r.press('scene.next');
        await r.run(1500, null);
        expect(r.host.runner!.phase).toBe('flying');
        const said0 = r.engine.said.length;
        const cues0 = r.engine.cues.length;
        r.press('sonic.repeat');
        await r.run(60000, null, () => r.engine.said.slice(said0).some((s) => s.line.key === 'fly.go-on'));
        const lesson = getLesson('rings-first');
        const keys = r.engine.said.slice(said0).map((s) => s.line.key);
        expect(keys[0]).toBe(lesson.title.key);
        for (const l of lesson.intro) expect(keys, l.key).toContain(l.key);
        expect(keys.at(-1)).toBe('fly.go-on');
        const named = lesson.intro.flatMap((l) => (l.cues ?? []).map((c) => (typeof c === 'string' ? c : c.cue)));
        expect(named.length).toBeGreaterThan(0);
        for (const cue of named) expect(r.engine.cues.slice(cues0).filter((c) => c.kind === 'repeat-cue' && c.cue === cue), cue).toHaveLength(REPEAT_PLAYS);
        // the attempt waited for it: the same attempt goes on
        expect(r.host.runner!.view()).toMatchObject({ phase: 'flying', listening: false, attempt: 1 });
    }, 120000);

    it('B while flying: back to the task, the attempt dropped uncounted; the next attempt begins after the task', async () => {
        const r = await open('rings-first');
        r.press('scene.next');
        await r.run(1500, null);
        expect(r.host.runner!.phase).toBe('flying');
        const n0 = r.sonic.length;
        r.press('feedback.open');
        expect(r.host.runner!.view()).toMatchObject({ phase: 'intro', step: 1, stepKind: 'task' });
        await r.run(120000, null, () => r.host.runner!.phase === 'flying');
        const after = r.sonic.slice(n0).filter((e) => e.kind === 'lesson');
        expect(after.filter((e) => e.kind === 'lesson' && (e.what === 'attempt-pass' || e.what === 'attempt-fail'))).toEqual([]);
        expect(after.filter((e) => e.kind === 'lesson' && e.what === 'attempt-start')).toHaveLength(1);
        expect(r.host.runner!.view().counted).toBe(0);
    }, 300000);

    it('a lesson flown with N, Z and B and passed replays PASS (every event re-derived); control: without its key events it does not', async () => {
        const r = await open('rings-first');
        const rec = recorder(throughTheGate);
        await r.run(1200, rec.control);
        r.press('scene.next');
        await r.run(80000, rec.control, () => r.lessonEvents('attempt-start').length >= 2);
        await r.run(1500, rec.control);
        r.press('sonic.repeat');
        await r.run(60000, rec.control, () => r.engine.said.some((s) => s.line.key === 'fly.go-on'));
        await r.run(1000, rec.control);
        r.press('feedback.open');
        await r.run(2500, rec.control);
        r.press('scene.next');
        await r.run(240000, rec.control, () => r.passed);
        await r.run(600, rec.control);
        expect(r.passed).toBe(true);
        expect(r.of('key').map((e) => e.action)).toEqual(['next', 'repeat', 'previous', 'next']);
        expect(r.lessonEvents('open').map((e) => e.lessonId)).toEqual(['rings-first']);
        const manifest = manifestOf(r, 'rings-first', 'keysSession00000001');
        const { check } = checkSession({ manifest, frames: rec.frames, events: r.sonic });
        expect(check.events.diffs).toEqual([]);
        expect(check.ok, JSON.stringify({ notes: check.notes, cues: check.cues })).toBe(true);
        const bare = checkSession({ manifest, frames: rec.frames, events: r.sonic.filter((e) => e.kind !== 'key') });
        expect(bare.check.ok).toBe(false);
        expect(bare.check.events.diffs.length).toBeGreaterThan(0);
    }, 300000);

    it('in a lesson B is the lesson\'s (the step before), not the page\'s feedback form; when the lesson ends, B is the form\'s again', async () => {
        let forms = 0;
        const r = await open('rings-first', (rr) => {
            // the feedback feature's handler, installed before the mode as on the page (app/features.ts)
            rr.keys.set('feedback.open', [() => { forms++; }]);
        });
        r.press('scene.next');
        r.press('feedback.open');
        expect(forms).toBe(0);
        expect(r.of('key').map((e) => e.action)).toEqual(['next', 'previous']);
        r.host.close();
        r.press('feedback.open');
        expect(forms).toBe(1);
        expect(r.of('key')).toHaveLength(2);
    }, 120000);
});

// ------------------------------------------------------------------ B4

/** The simulator's English lines of the mode (packages/i18n/locales/fly/sonic/en.json), filled in as the page's t() fills them. */
const SONIC_EN = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'sonic', 'en.json'), 'utf8')) as Record<string, string>;
function tEn(key: string, params?: Readonly<Record<string, string | number>>): string {
    let s = SONIC_EN[key] ?? key;
    for (const [k, v] of Object.entries(params ?? {})) s = s.split(`{${k}}`).join(String(v));
    return s;
}

/** A view with the given fields over a flying lesson's in its first attempt. */
const viewOf = (o: Partial<LessonView>): LessonView => ({ lessonId: 'rings-first', title: { key: 'lesson.rings-first.title' }, lessonIndex: 20, lessonCount: 28, path: 'full', step: 2, steps: 2, stepKind: 'fly', goal: 1, goals: 1, attempt: 1, counted: 0, required: 3, failsInARow: 0, offered: false, touches: 0, maxTouches: null, phase: 'flying', passed: false, skipped: false, listening: false, paused: false, playing: null, ...o });

describe('B4 (W6, M41-7): I says the runner\'s status line; a large panel draws its view after every attempt', () => {
    it('the panel\'s rows: the lesson on the path and the step always; in a flying lesson the attempt once one began and the count; module 0 its lesson and step only', () => {
        expect(progressRows(viewOf({ attempt: 2, counted: 1 })).map((r) => tEn(r.key, r.params))).toEqual(['Lesson 20 of 28', 'Step 2 of 2', 'Attempt 2', 'Counted 1 of 3']);
        expect(progressRows(viewOf({ step: 1, stepKind: 'task', attempt: 0, phase: 'intro' })).map((r) => tEn(r.key, r.params))).toEqual(['Lesson 20 of 28', 'Step 1 of 2', 'Counted 0 of 3']);
        expect(progressRows(viewOf({ lessonId: 'ears-glossary', lessonIndex: 2, step: 5, steps: 22, stepKind: 'sound', goal: 0, goals: 0, attempt: 1 })).map((r) => tEn(r.key, r.params))).toEqual(['Lesson 2 of 28', 'Step 5 of 22']);
        // every row's words exist in the four languages, with the same numbers in them
        for (const l of ['en', 'es', 'pl', 'ru']) {
            const d = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'sonic', `${l}.json`), 'utf8')) as Record<string, string>;
            for (const k of ['sonic.progress.label', 'sonic.progress.lesson', 'sonic.progress.step', 'sonic.progress.attempt', 'sonic.progress.counted']) expect(d[k], `${l} ${k}`).toBeTruthy();
            for (const k of ['sonic.progress.lesson', 'sonic.progress.step', 'sonic.progress.counted']) expect(d[k], `${l} ${k}`).toMatch(/\{n\}.*\{total\}/);
        }
    });

    it('I through the page\'s status board says runner.statusLine() through the mode\'s voice: lesson k of n, step, attempt, counted m of r', async () => {
        const r = await open('rings-first');
        const board = new StatusBoard();
        board.add({ order: STATUS_ORDER.lesson, line: () => r.host.status() });
        const say = (): { key: string; params: Record<string, unknown>; text: string } => {
            const n = r.engine.said.length;
            void sayStatus(board, (line, interrupt) => r.mode.bridge.say(line, interrupt));
            const said = r.engine.said.slice(n);
            expect(said).toHaveLength(1);
            expect(said[0]!.interrupt).toBe(true);
            return { key: said[0]!.line.key, params: { ...said[0]!.line.params }, text: said[0]!.text };
        };
        const index = lessonPaths().full.indexOf('rings-first') + 1;
        // the task: the lesson and the step
        expect(say()).toMatchObject({ key: 'status.progress-step', params: { lesson: index, lessons: 28, step: 1, steps: 2 } });
        await r.run(240000, throughTheGate, () => r.lessonEvents('attempt-pass').length === 1 && r.lessonEvents('attempt-start').length === 2);
        const now = say();
        expect(now).toMatchObject({ key: 'status.progress', params: { lesson: index, lessons: 28, step: 2, steps: 2, n: 2, counted: 1, required: getLesson('rings-first').pass.required } });
        expect(now.text).toContain(`Lesson ${index} of 28`);
        expect(now.text).toContain('Attempt 2. Counted 1 of 3.');
        // the line is the runner's own, word for word
        expect(now.key).toBe(r.host.runner!.statusLine().key);
        expect(now.params).toEqual(r.host.runner!.statusLine().params);
    }, 300000);

    it('the panel follows the lesson: hidden before one runs; after every attempt\'s start its number, after every counted attempt the count; I\'s numbers', async () => {
        rig = await Rig.make(getLesson('rings-first'));
        const r = rig;
        const doc = new FakeDocument();
        const panel = new ProgressPanel({ parent: doc.body as unknown as HTMLElement, text: tEn });
        const stop = followProgress(panel, (cb) => r.events.on('sonicEvent', cb), () => (r.host.runner ? { view: r.host.runner.view(), title: 'Rings' } : null));
        expect(panel.root.hidden).toBe(true);
        expect(panel.text).toBe('');
        expect(await r.host.open('rings-first')).toBe(true);
        expect(panel.root.hidden).toBe(false);
        expect(panel.root.getAttribute('aria-label')).toBe('Lesson progress');
        // what the panel showed when each attempt began and ended (the bus runs the panel's listener first: it subscribed first)
        const seen: { what: string; text: string }[] = [];
        r.events.on('sonicEvent', (e) => {
            if (e.kind === 'lesson' && (e.what === 'attempt-start' || e.what === 'attempt-pass' || e.what === 'attempt-fail')) seen.push({ what: e.what, text: panel.text });
        });
        await r.run(300000, throughTheGate, () => r.passed);
        expect(r.passed).toBe(true);
        let starts = 0;
        let counted = 0;
        for (const s of seen) {
            if (s.what === 'attempt-start') expect(s.text, s.text).toContain(`Attempt ${++starts}`);
            if (s.what === 'attempt-pass') expect(s.text, s.text).toContain(`Counted ${++counted} of 3`);
        }
        expect(starts).toBeGreaterThanOrEqual(3);
        expect(counted).toBe(3);
        expect(panel.text.split('\n')).toEqual(['Rings', `Lesson ${lessonPaths().full.indexOf('rings-first') + 1} of 28`, 'Step 2 of 2', `Attempt ${starts}`, 'Counted 3 of 3']);
        // the same numbers as I
        const line = r.host.runner!.statusLine();
        expect(panel.text).toContain(`Counted ${line.params!.counted} of ${line.params!.required}`);
        stop();
    }, 300000);

    it('its place and colours (sonic.css): at the left edge, clear of the view\'s centre, opaque, white on black and black on white', () => {
        const css = readFileSync(join(REPO, 'apps', 'fly', 'src', 'sonic', 'sonic.css'), 'utf8');
        const rule = (sel: RegExp): string => sel.exec(css)?.[1] ?? '';
        const main = rule(/\.sonic-progress \{([^}]*)\}/);
        expect(main).toMatch(/position: fixed/);
        expect(main).toMatch(/left: max\(12px, env\(safe-area-inset-left\)\)/);
        expect(main).not.toMatch(/left: 50%|right:/);
        expect(main).toMatch(/max-width: min\(30vw, 360px\)/);
        expect(main).toMatch(/background: #000;/);
        expect(main).toMatch(/color: #fff;/);
        expect(main).toMatch(/border: 3px solid #fff/);
        expect(main).toMatch(/z-index: 4;/);
        const light = rule(/@media \(prefers-color-scheme: light\) \{ \.sonic-progress \{([^}]*)\}/);
        expect(light).toMatch(/background: #fff;/);
        expect(light).toMatch(/color: #000;/);
        expect(rule(/@media \(forced-colors: active\) \{ \.sonic-progress \{([^}]*)\}/)).toMatch(/background: Canvas;/);
    });
});

// ------------------------------------------------------------------ B5

/** The flight held or let go as the page's pause stack does it, and told to the bridge at once (the page's 'pause' event). */
function hold(r: Rig, on: boolean): void {
    r.session.pause(on, 'menu');
    r.mode.bridge.syncPause();
}

const ends = (r: Rig): SessionEvent[] => r.sonic.filter((e) => e.kind === 'speech' && e.key === SPEECH_END_KEY);

describe('B5 (W8): the runner pauses and resumes where the session\'s pause and resume are written; no end of speech while paused', () => {
    it('the pause reaches the runner at once, at the t of the session event; the resume too', async () => {
        const r = await open('rings-first');
        await r.run(1000, null);
        hold(r, true);
        const pause = r.of('session').at(-1)!;
        expect(pause).toMatchObject({ what: 'pause' });
        expect(r.host.runner!.view().paused).toBe(true);
        await r.run(5000, null);
        expect(r.of('session').filter((e) => e.what === 'pause')).toHaveLength(1);
        hold(r, false);
        expect(r.of('session').at(-1)).toMatchObject({ what: 'resume', t: pause.t + 5000 });
        expect(r.host.runner!.view().paused).toBe(false);
    }, 120000);

    it('a question asked before the pause does not time out in it: open after a pause three times its time, and skipped ASK_TIMEOUT_S of lesson time after it was asked', async () => {
        const r = await open('ears-headphones');
        await r.run(240000, null, () => r.host.asking && !r.engine.speaking);
        expect(r.host.asking).toBe(true);
        const asked = r.mode.bridge.now();
        const answers = r.of('answer').length;
        hold(r, true);
        await r.run(ASK_TIMEOUT_S * 3000, null);
        hold(r, false);
        await r.run(1000, null);
        expect(r.of('answer')).toHaveLength(answers);
        expect(r.host.asking).toBe(true);
        await r.run(60000, null, () => r.of('answer').length > answers);
        const skip = r.of('answer').at(-1)!;
        expect(skip).toMatchObject({ via: 'skip', value: null });
        // its 20 s ran outside the pause (the question's lines were said before it: within a second of lesson time)
        const lessonTime = skip.t - asked - ASK_TIMEOUT_S * 3000;
        expect(lessonTime).toBeGreaterThanOrEqual(ASK_TIMEOUT_S * 1000 - 1000);
        expect(lessonTime).toBeLessThan(ASK_TIMEOUT_S * 1000 + 1000);
    }, 300000);

    it('no speech.end and no runner.spoken while paused (the menu\'s lines); one at the resume when the queue is empty; the task\'s sound waits for it', async () => {
        const r = await open('rings-first');
        // the task's first part is being said; the flight pauses and a line of the menu cuts it
        await r.run(500, null);
        expect(r.engine.speaking).toBe(true);
        const ends0 = ends(r).length;
        const cues0 = r.engine.cues.length;
        hold(r, true);
        void r.mode.bridge.say({ key: 'status.none' }, true);
        await r.run(15000, null);
        expect(r.engine.speaking).toBe(false);
        expect(ends(r)).toHaveLength(ends0);
        expect(r.engine.cues.slice(cues0).filter((c) => c.kind === 'repeat-cue')).toEqual([]);
        hold(r, false);
        const resume = r.of('session').at(-1)!;
        expect(ends(r)).toHaveLength(ends0 + 1);
        expect(ends(r).at(-1)!.t).toBe(resume.t);
        // the lesson goes on from there: the named sound of its first part plays
        await r.run(10000, null);
        expect(r.engine.cues.slice(cues0).some((c) => c.kind === 'repeat-cue')).toBe(true);
    }, 120000);

    it('resumed while a line is still being said: no end of speech at the resume, one when the line ends', async () => {
        const r = await open('rings-first');
        await r.run(500, null);
        const ends0 = ends(r).length;
        hold(r, true);
        void r.mode.bridge.say({ key: 'status.none' }, true);
        hold(r, false);
        expect(r.engine.speaking).toBe(true);
        expect(ends(r)).toHaveLength(ends0);
        await r.run(10000, null, () => ends(r).length > ends0);
        expect(ends(r)).toHaveLength(ends0 + 1);
        expect(r.engine.speaking).toBe(false);
    }, 120000);

    it('a lesson opened while the flight is paused waits from its start: the pause written after its open, the runner paused, nothing goes on until the resume', async () => {
        rig = await Rig.make(getLesson('rings-first'));
        const r = rig;
        r.session.pause(true, 'menu');
        expect(await r.host.open('rings-first')).toBe(true);
        const events = r.sonic.map((e) => (e.kind === 'session' ? `session ${e.what}` : e.kind === 'lesson' ? `lesson ${e.what}` : e.kind));
        expect(events.indexOf('session pause')).toBeGreaterThan(events.indexOf('lesson open'));
        expect(r.host.runner!.view().paused).toBe(true);
        await r.run(20000, null);
        expect(ends(r)).toHaveLength(0);
        expect(r.host.runner!.phase).toBe('intro');
        hold(r, false);
        expect(ends(r)).toHaveLength(1);
        await r.run(60000, null, () => r.host.runner!.phase === 'flying');
        expect(r.host.runner!.phase).toBe('flying');
    }, 120000);

    it('a session paused for longer than an attempt\'s time limit in the attempt replays PASS: the attempt is not failed, the ring counts; control: without its session events the replay fails it', async () => {
        const r = await open('rings-first');
        const rec = recorder(null);
        await r.run(1200, rec.control);
        r.press('scene.next');
        await r.run(1000, rec.control);
        expect(r.host.runner!.phase).toBe('flying');
        const limitMs = (getLesson('rings-first').attemptLimitS ?? 60) * 1000;
        hold(r, true);
        await r.run(limitMs + 10000, rec.control);
        hold(r, false);
        const fly = recorder(throughTheGate);
        // the same frame list, the gate flown now
        fly.frames.push(...rec.frames);
        await r.run(30000, fly.control, () => r.lessonEvents('attempt-pass').length >= 1);
        await r.run(600, fly.control);
        expect(r.lessonEvents('attempt-fail')).toEqual([]);
        expect(r.lessonEvents('attempt-pass')).toHaveLength(1);
        const manifest = manifestOf(r, 'rings-first', 'pauseSession0000001');
        const { check } = checkSession({ manifest, frames: fly.frames, events: r.sonic });
        expect(check.events.diffs).toEqual([]);
        expect(check.ok, JSON.stringify({ notes: check.notes, cues: check.cues })).toBe(true);
        const bare = checkSession({ manifest, frames: fly.frames, events: r.sonic.filter((e) => e.kind !== 'session') });
        expect(bare.check.ok).toBe(false);
        expect(bare.check.events.diffs.some((d) => d.problem === 'extra' && d.derived?.kind === 'lesson' && d.derived.what === 'attempt-fail')).toBe(true);
    }, 300000);
});
