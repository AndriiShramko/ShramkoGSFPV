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

export function resolver(curated: Record<string, number> = {}): PresetResolver {
    return {
        field: (id, key) => {
            const v = PRESETS.find((p) => p.id === id)?.fields[key]?.value;
            return typeof v === 'number' ? v : undefined;
        },
        curatedScale: (scene) => curated[scene]
    };
}

export const T0 = Date.UTC(2026, 9, 2, 9, 14, 3, 120);
export const clock = () => T0;

export function mkStore(backend: Backend = new MemoryBackend(), o: StoreOptions = {}, schema: Schema = SCHEMA, curated: Record<string, number> = {}): PrefsStore {
    return new PrefsStore(schema, backend, resolver(curated), { now: clock, debounceMs: 0, ...o });
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
