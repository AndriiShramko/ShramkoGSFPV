// The legend of the 3D drone stage (apps/fly/src/drones3d/callouts.ts, orbit.ts; v0.9 lane D) in four languages.
// Claims, each with a negative control:
//  - every drone's rows exist in en, es, pl and ru with no key missing and no {placeholder} left over (control: a
//    dictionary without one key is caught by the same predicate);
//  - the rows say the truth the owner asked for: the cinelifter carries a RED KOMODO 6K by default and says it is sold
//    without a camera; the other eight say their action camera is not carried (the DJI ones say why: they record
//    themselves); only a GoPro payload makes an action-camera row with a name;
//  - the maker's names stay as written in every language (the motor, the prop, the unit), numbers come from the preset;
//  - every fact that is not from the maker's page says so (basis), every maker or listing row links its source;
//  - the turntable: it turns after a quiet moment, a drag turns it and stops that, zoom and pitch stay in range, a legend
//    row's view is reached, and yaw 0 looks at the model's front (-Z) with positive yaw to the model's right (+X).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PresetJson } from '@gsfpv/sim-core';
import { DRONE_IDS } from '../../../packages/prefs/src/defs/drone';
import { PRESETS, REPO } from '../../../packages/prefs/test/helpers';
import { buildFor } from '../../../apps/fly/src/drones3d/build';
import { calloutRows, cinelifterNote } from '../../../apps/fly/src/drones3d/callouts';
import type { Say } from '../../../apps/fly/src/drones3d/callouts';
import { AUTO_SPIN, DIST_MAX, DIST_MIN, HOME, IDLE_RESUME_S, Orbit, PITCH_MAX, PITCH_MIN, viewPosition } from '../../../apps/fly/src/drones3d/orbit';
import { PAYLOAD_IDS } from '../../../apps/fly/src/drones3d/payloads';

type Dict = Record<string, string>;
const LANGS = ['en', 'es', 'pl', 'ru'] as const;
const dict = (l: string): Dict => JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'drones3d', `${l}.json`), 'utf8')) as Dict;
const DICTS: Record<string, Dict> = Object.fromEntries(LANGS.map((l) => [l, dict(l)]));
const preset = (id: string): PresetJson => PRESETS.find((p) => p.id === id) as unknown as PresetJson;

/** A text function that throws on a missing key, like a dictionary with a hole would show as a raw key */
function sayIn(d: Dict, missing: string[] = []): Say {
    return (key, vars) => {
        const raw = d[key];
        if (raw === undefined) { missing.push(key); return key; }
        let s = raw;
        for (const [k, v] of Object.entries(vars ?? {})) s = s.split(`{${k}}`).join(String(v));
        return s;
    };
}
const leftovers = (s: string): boolean => /\{[a-z]+\}/i.test(s);

describe('legend rows in four languages', () => {
    it('every drone, every language: no missing key, no placeholder left', () => {
        for (const l of LANGS) {
            const missing: string[] = [];
            const say = sayIn(DICTS[l], missing);
            for (const id of DRONE_IDS) {
                const b = buildFor(preset(id));
                const rows = calloutRows(b, say);
                expect(rows.length).toBeGreaterThanOrEqual(6);
                for (const r of rows) for (const text of [r.label, r.title, ...r.facts]) { expect(text.length, `${l} ${id} ${r.id}`).toBeGreaterThan(0); expect(leftovers(text), `${l} ${id} ${r.id}: ${text}`).toBe(false); }
                const note = cinelifterNote(b, say);
                if (note) expect(leftovers(note)).toBe(false);
            }
            expect(missing, `${l} lacks keys`).toEqual([]);
        }
        // control: a dictionary without one key is caught
        const hole: Dict = { ...DICTS.en };
        delete hole['d3.f.blades'];
        const missing: string[] = [];
        calloutRows(buildFor(preset('nazgulf5v3-6s')), sayIn(hole, missing));
        expect(missing).toContain('d3.f.blades');
    });

    it('the four dictionaries hold the same keys', () => {
        const keys = (d: Dict): string[] => Object.keys(d).sort();
        for (const l of LANGS) expect(keys(DICTS[l]), l).toEqual(keys(DICTS.en));
    });

    it('the maker\'s names are not translated and the numbers come from the preset', () => {
        for (const l of LANGS) {
            const say = sayIn(DICTS[l]);
            const evoque = calloutRows(buildFor(preset('nazgulf5v3-6s')), say);
            expect(evoque.find((r) => r.id === 'motors')!.title).toBe('XING2 2207 1750 KV');
            expect(evoque.find((r) => r.id === 'camera')!.title).toBe('DJI O4 Air Unit Pro');
            expect(evoque.find((r) => r.id === 'battery')!.title).toBe('6S 1480 mAh');
            const taurus = calloutRows(buildFor(preset('taurusx8-komodo-6s')), say);
            expect(taurus.find((r) => r.id === 'motors')!.title).toBe('XING2 3110 1250 KV');
            expect(taurus.find((r) => r.id === 'payload')!.title).toBe('RED KOMODO 6K');
            const pavo = calloutRows(buildFor(preset('pavo20pro-3s')), say);
            expect(pavo.find((r) => r.id === 'motors')!.title).toBe('LAVA 1104 7200 KV');
            expect(pavo.find((r) => r.id === 'battery')!.title).toBe('3S 550 mAh');
        }
    });

    it('the cinelifter carries a RED KOMODO 6K by default and says it is sold without a camera; the others carry no action camera', () => {
        const say = sayIn(DICTS.en);
        for (const id of DRONE_IDS) {
            const b = buildFor(preset(id));
            const rows = calloutRows(b, say);
            const action = rows.find((r) => r.id === 'action')!;
            expect(action.none, id).toBe(true);
            expect(action.title).toBe('None');
            const payload = rows.find((r) => r.id === 'payload');
            if (id === 'taurusx8-komodo-6s') {
                expect(payload?.title).toBe('RED KOMODO 6K');
                expect(payload?.facts.join(' ')).toContain('2000 g');
                expect(cinelifterNote(b, say)).toContain('Sold without a camera');
                expect(cinelifterNote(b, say)).toContain('Blackmagic BMPCC');
            } else {
                expect(payload, id).toBeUndefined();
                expect(cinelifterNote(b, say), id).toBeNull();
            }
        }
        // the DJI drones say why they carry no action camera: the unit records itself
        const evoque = calloutRows(buildFor(preset('nazgulf5v3-6s')), say).find((r) => r.id === 'action')!;
        expect(evoque.facts[0]).toContain('records video itself');
        // an analog drone does not
        const racer = calloutRows(buildFor(preset('machr5sport-6s')), say).find((r) => r.id === 'action')!;
        expect(racer.facts[0]).not.toContain('records');
    });

    it('each camera choice of the cinelifter changes the rows: a GoPro is an action camera, none is none', () => {
        const say = sayIn(DICTS.en);
        const rowsOf = (p: (typeof PAYLOAD_IDS)[number]) => calloutRows(buildFor(preset('taurusx8-komodo-6s'), p), say);
        const gopro = rowsOf('gopro13');
        expect(gopro.find((r) => r.id === 'action')!.title).toBe('GoPro HERO13 Black');
        expect(gopro.find((r) => r.id === 'action')!.none).toBeUndefined();
        expect(gopro.find((r) => r.id === 'payload')).toBeUndefined();
        const none = rowsOf('none');
        expect(none.find((r) => r.id === 'payload')!.none).toBe(true);
        expect(none.find((r) => r.id === 'payload')!.facts.join(' ')).toContain('2872 g');
        expect(rowsOf('bmpcc6kpro').find((r) => r.id === 'payload')!.title).toBe('Blackmagic Pocket Cinema Camera 6K Pro');
        expect(rowsOf('bmpcc6kpro').find((r) => r.id === 'payload')!.facts.join(' ')).toContain('2288 g');
    });

    it('typical facts say so, maker and listing rows link their source', () => {
        const say = sayIn(DICTS.en);
        const typical: Record<string, string[]> = {};
        for (const id of DRONE_IDS) {
            for (const r of calloutRows(buildFor(preset(id)), say)) {
                if (r.basis === 'typical') (typical[id] ??= []).push(r.id);
                else if (!r.none) expect(r.ref, `${id} ${r.id}`).toMatch(/^https:\/\//);
            }
        }
        // what the makers do not say: the connector of three packs, and the racer's camera model
        expect(typical).toEqual({ 'pavopico-2s': ['battery'], 'nazgulf5v3-6s': ['battery'], 'machr5sport-6s': ['battery', 'camera'] });
        const racerCam = calloutRows(buildFor(preset('machr5sport-6s')), say).find((r) => r.id === 'camera')!;
        expect(racerCam.basis).toBe('typical');
        expect(calloutRows(buildFor(preset('machr5sport-6s')), say).find((r) => r.id === 'vtx')!.basis).toBe('maker');
    });
});

describe('the turntable', () => {
    it('turns by itself only after a quiet moment, and a drag stops that', () => {
        const o = new Orbit();
        const y0 = o.state.yaw;
        o.tick(1);
        expect(o.state.yaw).toBe(y0); // still waiting
        for (let t = 0; t < IDLE_RESUME_S + 0.1; t += 0.1) o.tick(0.1);
        const y1 = o.state.yaw;
        o.tick(1);
        expect(Math.abs(o.state.yaw - y1)).toBeCloseTo(AUTO_SPIN, 6);
        // a drag moves it and the wait starts over
        o.grab();
        for (let i = 0; i < 20; i++) o.drag(5, 0, 600, 1 / 60);
        o.release();
        const y2 = o.state.yaw;
        expect(y2).not.toBeCloseTo(y1 + AUTO_SPIN, 3);
        const before = o.state.yaw;
        for (let t = 0; t < 1.5; t += 0.05) o.tick(0.05); // only the momentum
        const coast = Math.abs(o.state.yaw - before);
        expect(coast).toBeLessThan(90);
        // control: a reduced-motion player's stage never turns by itself
        const still = new Orbit();
        still.reduceMotion = true;
        const s0 = still.state.yaw;
        for (let t = 0; t < 30; t += 0.1) still.tick(0.1);
        expect(still.state.yaw).toBe(s0);
    });

    it('pitch and zoom stay in range', () => {
        const o = new Orbit();
        o.grab();
        o.drag(0, 5000, 600);
        expect(o.state.pitch).toBe(PITCH_MAX);
        o.drag(0, -50000, 600);
        expect(o.state.pitch).toBe(PITCH_MIN);
        for (let i = 0; i < 100; i++) o.zoom(500);
        expect(o.state.dist).toBe(DIST_MAX);
        for (let i = 0; i < 100; i++) o.zoom(-500);
        expect(o.state.dist).toBe(DIST_MIN);
    });

    it('flyTo reaches the view a legend row asks for, by the short way round', () => {
        const o = new Orbit();
        o.state.yaw = 170;
        o.flyTo({ yaw: -170, pitch: 30, dist: 1.8 });
        let steps = 0;
        let maxJump = 0;
        let last = o.state.yaw;
        while (o.moving && steps < 2000) { o.tick(1 / 60); maxJump = Math.max(maxJump, Math.abs(((o.state.yaw - last + 540) % 360) - 180)); last = o.state.yaw; steps++; if (steps > 600) break; }
        expect(o.state.yaw).toBeCloseTo(-170, 1);
        expect(o.state.pitch).toBeCloseTo(30, 1);
        expect(o.state.dist).toBeCloseTo(1.8, 2);
        expect(maxJump).toBeLessThan(40); // never the long way round (340 degrees)
    });

    it('yaw 0 looks at the front (-Z) from straight ahead, positive yaw is the model\'s right (+X); home is front-right and above', () => {
        const front = viewPosition({ yaw: 0, pitch: 0, dist: 2 }, 1, [0, 0, 0]);
        expect(front[2]).toBeCloseTo(-2, 9);
        expect(front[0]).toBeCloseTo(0, 9);
        const right = viewPosition({ yaw: 90, pitch: 0, dist: 2 }, 1, [0, 0, 0]);
        expect(right[0]).toBeCloseTo(2, 9);
        const home = viewPosition(HOME, 1, [0, 0, 0]);
        expect(home[0]).toBeGreaterThan(0);
        expect(home[1]).toBeGreaterThan(0);
        expect(home[2]).toBeLessThan(0);
    });
});
