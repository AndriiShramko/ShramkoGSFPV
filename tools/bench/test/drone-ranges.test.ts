// Every drone can be flown at every end of every flight-model setting (review R5 of lane D, docs/wip/v08-d.md).
// The rule: for every preset in packages/sim-core/presets, with each preset field that documents a fitting
// range ("min"/"max": twr, motor_tau_ms, rotor drag and inertia, wake_loss, wake_shake) at its value and at
// both ends of that range, and with each numeric setting that builds the flight model (app/prefs.ts
// FLIGHT_MODEL_SETTINGS) at both ends the store allows, the app's own path (store -> overridesFor ->
// compileParams) builds a flight model with finite numbers. A preset fitted to a pilot's report anywhere in
// its documented range must never become a drone the app cannot build because a pilot moved a slider.
// The case that broke: a preset's wake_loss at its documented max 0.5 times the prop wash setting's max 2
// threw a RangeError in sim-core's wakeOf; the product is now capped at WAKE_LOSS_MAX.
// Negative control: the same predicate on a broken preset copy (wake_loss documented up to 0.95, past the
// model's cap) reports it, so the rule can fail.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WAKE_LOSS_MAX, compileParams } from '@gsfpv/sim-core';
import type { PresetJson } from '@gsfpv/sim-core';
import { FakeStorage, REPO } from '../../../packages/prefs/test/helpers';
import { MemoryBackend, PrefsStore, SCHEMA } from '../../../packages/prefs/src';
import type { ShowcaseScene } from '../../../apps/fly/src/ui/scenes';

type AppPrefs = typeof import('../../../apps/fly/src/app/prefs');
type Presets = typeof import('../../../apps/fly/src/presets');
let P: AppPrefs, PR: Presets;

beforeAll(async () => {
    // the app's prefs module reads the page at import, as app-settings.test.ts stubs it
    vi.stubGlobal('location', { href: 'http://127.0.0.1/fly/', search: '', pathname: '/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('history', { state: null, replaceState: () => undefined });
    vi.stubGlobal('document', { cookie: '', documentElement: { lang: '' } });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    P = await import('../../../apps/fly/src/app/prefs');
    PR = await import('../../../apps/fly/src/presets');
});

const SHOWCASE = (JSON.parse(readFileSync(join(REPO, 'apps', 'fly', 'public', 'showcase.json'), 'utf8')) as { scenes: ShowcaseScene[] }).scenes;

/** A preset copy with one field's value replaced. */
function withValue(p: PresetJson, key: string, value: number): PresetJson {
    const c = structuredClone(p);
    c.fields[key] = { ...c.fields[key], value };
    return c;
}

/** The preset itself and, for each field with a documented fitting range, a copy at each end of it. */
function variants(p: PresetJson): { label: string; preset: PresetJson }[] {
    const out = [{ label: `${p.id}`, preset: p }];
    for (const [key, f] of Object.entries(p.fields) as [string, { value: unknown; min?: number; max?: number }][]) {
        for (const end of ['min', 'max'] as const) {
            const v = f[end];
            if (typeof v === 'number' && typeof f.value === 'number') out.push({ label: `${p.id} ${key}=${end} ${v}`, preset: withValue(p, key, v) });
        }
    }
    return out;
}

/** Everything that fails to build: "<variant> | <setting>=<value>: <error>". Empty when every drone flies. */
function unbuildable(presets: readonly PresetJson[]): string[] {
    const numeric = P.FLIGHT_MODEL_SETTINGS.filter((id) => SCHEMA.byId.get(id)?.type === 'number');
    const problems: string[] = [];
    for (const p of presets) {
        for (const v of variants(p)) {
            for (const id of [null, ...numeric]) {
                for (const far of id === null ? [0] : [-1e9, 1e9]) {
                    const store = new PrefsStore(SCHEMA, new MemoryBackend(), P.presetResolver(PR.PRESETS, SHOWCASE), { debounceMs: 0 });
                    // the store clamps a far value to the end it allows for this drone (its own bounds)
                    if (id !== null) store.set(id, far, { drone: p.id });
                    const at = id === null ? 'defaults' : `${id}=${String(store.get(id, { drone: p.id }))}`;
                    try {
                        const sp = compileParams(v.preset, P.overridesFor(store, p.id));
                        const nums = [sp.mass, sp.tmaxMotorNom, sp.tau, sp.wakeLoss, sp.wakeShake, sp.wakeArea, ...sp.inertia];
                        if (!nums.every(Number.isFinite)) problems.push(`${v.label} | ${at}: a number is not finite`);
                        else if (sp.wakeLoss < 0 || sp.wakeLoss > WAKE_LOSS_MAX) problems.push(`${v.label} | ${at}: wakeLoss ${sp.wakeLoss}`);
                    } catch (e) {
                        problems.push(`${v.label} | ${at}: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
            }
        }
    }
    return problems;
}

describe('every drone builds at every end of its documented ranges and of every flight-model setting (review R5)', () => {
    it('all presets, all documented field ranges, every numeric flight-model setting at both ends', () => {
        expect(P.FLIGHT_MODEL_SETTINGS).toContain('physics.propWash');
        expect(unbuildable(Object.values(PR.PRESETS))).toEqual([]);
    });

    it('the case that threw: the cinelifter fitted to wake_loss 0.5 (its documented max) at prop wash 2x flies with the loss capped', () => {
        const cine = PR.PRESETS['taurusx8-komodo-6s'];
        expect(cine.fields.wake_loss.max).toBe(0.5);
        const fitted = withValue(cine, 'wake_loss', 0.5);
        expect(compileParams(fitted, { wake: 2 }).wakeLoss).toBe(WAKE_LOSS_MAX);
        expect(compileParams(fitted, { wake: 1 }).wakeLoss).toBe(0.5);
    });

    it('control: a preset documenting wake_loss up to 0.95 (past the model\'s cap) is reported by the same predicate', () => {
        const cine = PR.PRESETS['taurusx8-komodo-6s'];
        const broken = structuredClone(cine);
        broken.fields.wake_loss = { ...broken.fields.wake_loss, max: 0.95 };
        const found = unbuildable([broken]);
        expect(found.length).toBeGreaterThan(0);
        expect(found.every((s) => s.startsWith('taurusx8-komodo-6s wake_loss=max 0.95'))).toBe(true);
    });
});
