// Setting ranges quoted in hand-written public texts follow the settings schema (review R1 of lane D,
// docs/wip/v08-d.md). gen-catalog rewrites only its generated blocks; the README's feature table and the
// roadmap seed (the landing's status list for a fresh ideas store) quote ranges in prose and went stale when
// lane D widened the motor spin-up time to 8-80 ms ("8-30 ms" stayed). Each quote below is read from its
// file and compared with the schema's min and max.
// Negative control: the same predicate on the pre-R1 text ("8–30 ms") is refused.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../../../packages/prefs/test/helpers';
import { SCHEMA } from '../../../packages/prefs/src';

/** A quoted range: where it is read from, how, and the setting it must equal. */
const QUOTES: { what: string; text: () => string; re: RegExp; setting: string }[] = [
    { what: 'README feature table', text: () => readFileSync(join(REPO, 'README.md'), 'utf8'), re: /Motor spin-up time ([\d.]+)–([\d.]+) ms/, setting: 'physics.tauMs' },
    { what: 'README feature table', text: () => readFileSync(join(REPO, 'README.md'), 'utf8'), re: /air drag ([\d.]+)–([\d.]+)×/, setting: 'physics.dragScale' },
    { what: 'roadmap seed (en)', text: () => seedEn(), re: /Motor spin-up time ([\d.]+)–([\d.]+) ms/, setting: 'physics.tauMs' },
    { what: 'roadmap seed (en)', text: () => seedEn(), re: /air drag ([\d.]+)–([\d.]+)×/, setting: 'physics.dragScale' }
];

function seedEn(): string {
    const seed = JSON.parse(readFileSync(join(REPO, 'apps', 'api', 'locales', 'roadmap-seed.json'), 'utf8')) as { items: { title: { en: string } }[] };
    return seed.items.map((i) => i.title.en).join('\n');
}

/** The schema's [min, max] of a numeric setting with fixed bounds. */
function bounds(id: string): [number, number] {
    const d = SCHEMA.byId.get(id) as { min: unknown; max: unknown } | undefined;
    if (!d || typeof d.min !== 'number' || typeof d.max !== 'number') throw new Error(`${id}: not a number setting with fixed bounds`);
    return [d.min, d.max];
}

/** The quote's problem, or null when it says the schema's range. */
function wrong(text: string, re: RegExp, setting: string): string | null {
    const m = re.exec(text);
    if (!m) return 'the quote is missing';
    const [lo, hi] = bounds(setting);
    return Number(m[1]) === lo && Number(m[2]) === hi ? null : `says ${m[1]}-${m[2]}, the schema ${lo}-${hi}`;
}

describe('ranges quoted in the public texts follow the settings schema (review R1)', () => {
    it('README and the roadmap seed quote the motor spin-up time and the air drag ranges of the schema', () => {
        expect(bounds('physics.tauMs')).toEqual([8, 80]);
        for (const q of QUOTES) expect(wrong(q.text(), q.re, q.setting), `${q.what}: ${q.setting}`).toBeNull();
    });

    it('control: the pre-R1 text (8–30 ms) is refused by the same predicate', () => {
        expect(wrong('| Drone & tuning | Motor spin-up time 8–30 ms and air drag 0.5–2× | Live |', QUOTES[0].re, 'physics.tauMs')).toBe('says 8-30, the schema 8-80');
        expect(wrong('no such row', QUOTES[0].re, 'physics.tauMs')).toBe('the quote is missing');
    });
});
