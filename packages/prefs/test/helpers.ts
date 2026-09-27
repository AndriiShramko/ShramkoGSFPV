// Shared test fixtures: the real drone presets (read from sim-core's folder, prefs does not depend
// on sim-core), a fixed clock, and a store factory on an in-memory backend.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryBackend, PrefsStore, SCHEMA } from '../src';
import type { Backend, CataloguePreset, PresetResolver, Schema, StoreOptions } from '../src';

export const REPO = join(__dirname, '..', '..', '..');
const PRESET_DIR = join(REPO, 'packages', 'sim-core', 'presets');

export const PRESETS: CataloguePreset[] = readdirSync(PRESET_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(PRESET_DIR, f), 'utf8')) as CataloguePreset);

/**
 * The real presets; `curated` = scale per scene, `scenes` = the admin's fields per scene, as a
 * showcase.json entry holds them ({ walls: 'off' }).
 */
export function resolver(curated: Record<string, number> = {}, scenes: Record<string, Record<string, unknown>> = {}): PresetResolver {
    return {
        field: (id, key) => {
            const v = PRESETS.find((p) => p.id === id)?.fields[key]?.value;
            return typeof v === 'number' ? v : undefined;
        },
        curatedScale: (scene) => curated[scene],
        curated: (scene, field) => (Object.hasOwn(scenes, scene) && Object.hasOwn(scenes[scene], field) ? scenes[scene][field] : undefined)
    };
}

/** What a pilot could change in v0.2 (panel, picker, Controls screen, Betaflight import, F3). */
export const V02_SETTINGS = ['camera.fovDeg', 'camera.uptiltDeg', 'display.hud', 'display.quality', 'display.reducedMotion', 'display.frameStats', 'ui.language', 'input.stickMode', 'drone.current', 'physics.gravity', 'physics.gravityMode', 'physics.vCrash', 'physics.tauMs', 'physics.dragScale', 'tune.pid', 'tune.rates', 'tune.throttle'];

/** What main shipped after v0.2 and before prefs was wired: the walls switch and the voxel grid. */
export const MAIN_SETTINGS = ['scene.walls', 'voxels.show', 'voxels.style', 'voxels.opacity', 'voxels.opacityOnly'];

export const T0 = Date.UTC(2026, 9, 2, 9, 14, 3, 120);
export const clock = () => T0;

export function mkStore(backend: Backend = new MemoryBackend(), o: StoreOptions = {}, schema: Schema = SCHEMA, curated: Record<string, number> = {}, scenes: Record<string, Record<string, unknown>> = {}): PrefsStore {
    return new PrefsStore(schema, backend, resolver(curated, scenes), { now: clock, debounceMs: 0, ...o });
}

/** A backend that answers every write with "ok" and keeps nothing: the private-window case. */
export class DroppingBackend implements Backend {
    writes = 0;
    read(): string | null {
        return null;
    }
    write(): boolean {
        this.writes++;
        return true;
    }
}

/** localStorage-like map that records every write, to prove legacy keys are never touched. */
export class FakeStorage {
    readonly m = new Map<string, string>();
    writes: string[] = [];
    constructor(init: Record<string, string> = {}) {
        for (const [k, v] of Object.entries(init)) this.m.set(k, v);
    }
    get length(): number {
        return this.m.size;
    }
    key(i: number): string | null {
        return [...this.m.keys()][i] ?? null;
    }
    getItem(k: string): string | null {
        return this.m.get(k) ?? null;
    }
    setItem(k: string, v: string): void {
        this.writes.push(k);
        this.m.set(k, v);
    }
    removeItem(k: string): void {
        this.writes.push(`-${k}`);
        this.m.delete(k);
    }
}
