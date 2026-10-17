// v0.9 lane C, item 14: the owner's default Scene size reaches every scene the simulator opens, and the
// order of precedence is: a shared link's settings > the pilot's own saved size > the owner's default > 1.
// The default is the store's default for `scene.transform` (the PresetResolver's curatedScale), and every
// way a scene opens (the picker, /fly/?scene=<id>, a pasted superspl.at link, N / auto-switch) reads the
// scene's starting size with `storedTransform(prefs, id)` (flight.ts fly(), scene-host.ts load()), so the
// claims are made on that one function. Node, no page: the app module reads location and document when it
// loads, so those are stubbed first. Every claim has a control: the base build's resolver (no `defaults`)
// or the plain store gives the other answer on the same input.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeStorage } from '../../../packages/prefs/test/helpers';
import { MemoryBackend, PrefsStore, SCHEMA } from '../../../packages/prefs/src';
import { parseSceneLink, readCatalog, sceneDefaultScale } from '../../../packages/scenes/src';
import type { SceneCatalog } from '../../../packages/scenes/src';

type AppPrefs = typeof import('../../../apps/fly/src/app/prefs');
type Presets = typeof import('../../../apps/fly/src/presets');
type Scale = typeof import('../../../apps/fly/src/app/builtin/scale');

let P: AppPrefs, PR: Presets, SC: Scale;

beforeAll(async () => {
    vi.stubGlobal('location', { href: 'http://127.0.0.1/fly/', search: '', pathname: '/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('history', { state: null, replaceState: () => undefined });
    vi.stubGlobal('document', { cookie: '', documentElement: { lang: '' } });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    P = await import('../../../apps/fly/src/app/prefs');
    PR = await import('../../../apps/fly/src/presets');
    SC = await import('../../../apps/fly/src/app/builtin/scale');
});

afterEach(() => P.closePagePrefs());

const LISTED = 'aaaaaa01';
const HIDDEN = 'aaaaaa02';
const PLAIN = 'aaaaaa03';
/** the public catalogue as the API sends it: one listed scene with a size, one hidden scene's size in `defaults`, one plain scene */
const CAT = readCatalog({ scenes: [{ id: LISTED, title: 'Listed', scale: 3 }, { id: PLAIN, title: 'Plain' }], defaults: { [HIDDEN]: { scale: 30 } } }) as SceneCatalog;

/** The store as boot.ts opens it for this catalogue; `withDefaults` false is the base build (no `defaults` handed on). */
function store(withDefaults = true): PrefsStore {
    return new PrefsStore(SCHEMA, new MemoryBackend(), P.presetResolver(PR.PRESETS, CAT.scenes, withDefaults ? CAT.defaults : undefined), { debounceMs: 0 });
}

/** The size a scene opens at: what fly() and SceneHost.load() pass to the session. */
const startSize = (prefs: PrefsStore, id: string): number => SC.storedTransform(prefs, id)?.s ?? 1;

describe('the owner default Scene size (item 14)', () => {
    it('a listed scene opens at its catalogue size, a hidden one at its public default, any other at 1', () => {
        const prefs = store();
        expect(startSize(prefs, LISTED)).toBe(3);
        expect(startSize(prefs, HIDDEN)).toBe(30);
        expect(startSize(prefs, PLAIN)).toBe(1);
        expect(startSize(prefs, 'ffffff00')).toBe(1); // a scan the owner never configured
        // control: the base build did not know the hidden scene's size (the picker's list was all it had)
        expect(startSize(store(false), HIDDEN)).toBe(1);
        expect(startSize(store(false), LISTED)).toBe(3);
    });

    it('every way of opening a scene reads the same default: a pasted link, the deep link\'s id, N', () => {
        const prefs = store();
        const pasted = parseSceneLink(`https://superspl.at/scene/${HIDDEN.toUpperCase()}?budget=8&stochastic`);
        expect(pasted?.id).toBe(HIDDEN);
        expect(startSize(prefs, pasted!.id)).toBe(30);
        expect(startSize(prefs, parseSceneLink(`superspl.at/s?id=${HIDDEN}`)!.id)).toBe(30);
        // N / auto-switch load by id through the same read; two scenes in a row keep their own sizes
        expect([LISTED, HIDDEN, PLAIN, HIDDEN].map((id) => startSize(prefs, id))).toEqual([3, 30, 1, 30]);
    });

    it('the pilot\'s own saved size wins over the owner\'s default, and a reset returns to the default', () => {
        const prefs = store();
        expect(prefs.set('scene.transform', { s: 2, t: [1, 0, 0], v: 5 }, { scene: HIDDEN }).ok).toBe(true);
        expect(startSize(prefs, HIDDEN)).toBe(2);
        expect(startSize(prefs, LISTED)).toBe(3); // another scene is not touched
        // even a saved size of 1 is the pilot's choice: it stays 1 under an owner default of 30
        prefs.set('scene.transform', { s: 1, t: [0, 0, 0], v: 0 }, { scene: HIDDEN });
        expect(startSize(prefs, HIDDEN)).toBe(1);
        prefs.reset('scene.transform', { scene: HIDDEN });
        expect(startSize(prefs, HIDDEN)).toBe(30);
        // control: the owner's default is not stored in the pilot's prefs, so changing it later reaches him
        expect(prefs.isExplicit('scene.transform', { scene: LISTED })).toBe(false);
    });

    it('the range reaches x100 (the catalogue\'s and the pilot\'s are the same) and the store clamps what is beyond', () => {
        const big = readCatalog({ scenes: [{ id: LISTED, title: 'A', scale: 100 }, { id: PLAIN, title: 'B', scale: 100.5 }] }) as SceneCatalog;
        const prefs = new PrefsStore(SCHEMA, new MemoryBackend(), P.presetResolver(PR.PRESETS, big.scenes, big.defaults), { debounceMs: 0 });
        expect(startSize(prefs, LISTED)).toBe(100);
        expect(startSize(prefs, PLAIN)).toBe(1); // out of range: the field is dropped by readScene, not clamped to a guess
        expect(sceneDefaultScale(big, LISTED)).toBe(100);
    });
});
