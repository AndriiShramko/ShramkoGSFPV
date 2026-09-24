import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compileParams } from '@gsfpv/sim-core';
import type { PresetJson, ParamOverrides, SimParams } from '@gsfpv/sim-core';
import { REPO } from './evidence';

const DIR = join(REPO, 'packages', 'sim-core', 'presets');

export function presetJson(id: string): PresetJson {
    return JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')) as PresetJson;
}

export function presetIds(): string[] {
    return readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}

export function params(id = 'pavo20pro-3s', o: ParamOverrides = {}): SimParams {
    return compileParams(presetJson(id), o);
}
