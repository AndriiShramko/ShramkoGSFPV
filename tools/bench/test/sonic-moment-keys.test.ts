// Train 4, lane tutor-air S2 (decision 4 page side, plan Part C 3): a moment's keys and the sounds the pilot knows.
//  - runnerOptions gives the runner the known sounds and the guide level only on a page that can freeze the flight (a MomentHost)
//    with the narrator on; the narrator off is the guide off (no moment runs), a host without a MomentHost runs as before;
//  - the known sounds are kept with the progress (SonicState.known): a new store on the same backend has them, each once; the
//    progress reset clears them; the saved collection keeps only cue ids;
//  - the bridge writes a moment key's event (moment.again / on / know) before the runner hears the key (the replay acts on it);
//  - in a moment N goes on and Z hears the sound again; outside one they are the next step and the task again, as before;
//  - the spoken lines (the keys once, "I know this" outside a moment, the K row) are the engine's (sonic.say.*) in four languages.
import { describe, expect, it } from 'vitest';
import { REPLAY_KEY_ACTIONS } from '../../../packages/sonic-fpv/src';
import type { CueId, LessonSession, MomentKey, SessionEvent } from '../../../packages/sonic-fpv/src';
import { MemoryBackend, validateCollection } from '../../../packages/prefs/src';
import { mkStore } from '../../../packages/prefs/test/helpers';
import { runnerOptions } from '../../../apps/fly/src/sonic/lessons';
import { addKnownSound, knownSounds, resetProgress } from '../../../apps/fly/src/sonic/store';
import { SonicBridge } from '../../../apps/fly/src/sonic/bridge';
import type { BridgeSession } from '../../../apps/fly/src/sonic/bridge';
import { SonicMode } from '../../../apps/fly/src/sonic/mode';
import { engineDicts } from '../../../apps/fly/src/sonic/host-lines';

type OptsPage = Parameters<typeof runnerOptions>[0];
const PLACE = { start: { pos: [0, 1, 0], yaw: 0 }, floorY: 0, objects: null, returnTo: null } as unknown as Parameters<typeof runnerOptions>[2];

function optsPage(store: ReturnType<typeof mkStore>, o: { moments: boolean; narratorOff?: boolean }): OptsPage {
    return {
        locale: 'en',
        store,
        path: () => 'fast',
        ...(o.moments ? { moments: {} } : {}),
        ...(o.narratorOff !== undefined ? { narratorOff: () => o.narratorOff === true } : {})
    } as unknown as OptsPage;
}

describe('the moment\'s runner options (known, guide)', () => {
    it('given with a MomentHost and the narrator on; absent with the narrator off or without a MomentHost (as before)', () => {
        const store = mkStore();
        store.updateCollection('sonic', (d) => {
            d.guide = 'full';
        });
        addKnownSound(store as never, 'safety.wall' as CueId);
        const on = runnerOptions(optsPage(store, { moments: true, narratorOff: false }), 'walls-hall', PLACE, 0);
        expect(on.known).toEqual(['safety.wall']);
        expect(on.guide).toBe('full');
        const fresh = runnerOptions(optsPage(mkStore(), { moments: true }), 'walls-hall', PLACE, 0);
        expect(fresh.known).toEqual([]);
        expect(fresh.guide).toBe('short');
        for (const p of [optsPage(store, { moments: true, narratorOff: true }), optsPage(store, { moments: false })]) {
            const o = runnerOptions(p, 'walls-hall', PLACE, 0);
            expect(o).not.toHaveProperty('known');
            expect(o).not.toHaveProperty('guide');
        }
    });
});

describe('the known sounds (SonicState.known)', () => {
    it('kept across a new store on the same backend, each once, in the order learned; the progress reset clears them', () => {
        const b = new MemoryBackend();
        const s1 = mkStore(b);
        expect(knownSounds(s1 as never)).toEqual([]);
        addKnownSound(s1 as never, 'safety.wall' as CueId);
        addKnownSound(s1 as never, 'target.hum' as CueId);
        addKnownSound(s1 as never, 'safety.wall' as CueId);
        const s2 = mkStore(b);
        expect(knownSounds(s2 as never)).toEqual(['safety.wall', 'target.hum']);
        resetProgress(s2 as never);
        expect(knownSounds(mkStore(b) as never)).toEqual([]);
    });

    it('the saved collection keeps cue ids only, each once (a bad entry is left out, the rest kept)', () => {
        const v = validateCollection('sonic', { v: 1, prefs: null, progress: {}, current: null, known: ['safety.wall', 7, 'NOT A CUE', 'safety.wall', 'target.hum'] });
        expect(v?.known).toEqual(['safety.wall', 'target.hum']);
        expect(validateCollection('sonic', { v: 1, prefs: null, progress: {}, current: null, known: 'safety.wall' })).not.toHaveProperty('known');
    });
});

describe('a moment\'s keys', () => {
    it('the bridge writes the key\'s event, then the runner hears it', () => {
        const events: SessionEvent[] = [];
        const heard: { key: MomentKey; eventsBefore: number }[] = [];
        const bridge = new SonicBridge({ sample: () => undefined, event: (e) => events.push(e) }, () => 1000);
        const run = {
            begin: () => [],
            momentKey: (key: MomentKey) => {
                heard.push({ key, eventsBefore: events.filter((e) => e.kind === 'key').length });
                return [];
            }
        } as unknown as LessonSession;
        const sim = { s: new Float64Array(64), tick: 0, ch: new Float64Array(8) };
        bridge.start({ runner: { sim, events: [], onStep: null }, paused: false, replaying: false, shownSim: sim } as unknown as BridgeSession);
        bridge.begin(run);
        bridge.momentKey('KeyZ', 'again');
        bridge.momentKey('KeyN', 'on');
        bridge.momentKey('KeyK', 'know');
        const keys = events.filter((e): e is Extract<SessionEvent, { kind: 'key' }> => e.kind === 'key');
        expect(keys.map((e) => [e.code, e.action])).toEqual([
            ['KeyZ', REPLAY_KEY_ACTIONS.momentAgain],
            ['KeyN', REPLAY_KEY_ACTIONS.momentOn],
            ['KeyK', REPLAY_KEY_ACTIONS.momentKnow]
        ]);
        expect(heard).toEqual([
            { key: 'again', eventsBefore: 1 },
            { key: 'on', eventsBefore: 2 },
            { key: 'know', eventsBefore: 3 }
        ]);
    });

    it('in a moment N goes on and Z hears it again; outside one N is the next step and Z the task again', () => {
        const calls: string[] = [];
        const bridge = {
            momentKey: (_c: string, k: MomentKey) => calls.push(`moment:${k}`),
            next: () => calls.push('next'),
            repeatTask: () => calls.push('repeat')
        };
        let moment = true;
        const mode = { on: true, inMoment: () => moment, bridge } as unknown as SonicMode;
        SonicMode.prototype.next.call(mode, 'KeyN');
        SonicMode.prototype.repeat.call(mode, 'KeyZ');
        moment = false;
        SonicMode.prototype.next.call(mode, 'KeyN');
        SonicMode.prototype.repeat.call(mode, 'KeyZ');
        expect(calls).toEqual(['moment:on', 'moment:again', 'next', 'repeat']);
    });

    it('the moment\'s spoken lines are the engine\'s, in four languages, with the keys\' places', () => {
        const d = engineDicts();
        for (const l of ['en', 'es', 'pl', 'ru'] as const) {
            expect(d[l]['sonic.say.momentKeys'], l).toMatch(/\{again\}[\s\S]*\{on\}[\s\S]*\{know\}/);
            expect(d[l]['sonic.say.momentKnowOutside'], l).toContain('{key}');
            expect(d[l]['sonic.say.helpKnow'], l).toContain('{key}');
        }
    });
});
