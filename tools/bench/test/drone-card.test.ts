// The drone picker card's hover throttle (apps/fly/src/ui/drone-card.ts; review R3 of lane D, docs/wip/v08-d.md).
// Claims, each with a negative control that fails the same predicate:
//  - every card gives the hover of sim-core's own solution (battery sag included) on a full pack and at
//    HOVER_LOW_SOC, as the HUD's THR shows it (the stick); full < near empty on every drone;
//  - the cinelifter's card says 41 % full (the research note's fresh-pack hover), not the 52 % of the old card
//    formula 1/sqrt(TWR), which is the hover near empty (control: the old formula fails "within 1 point of the
//    full-pack hover");
//  - on a drone with a throttle curve (the Pavo20 Pro 3S: thr_mid 65, thr_expo 20) the card is the stick, below
//    the motor command (control: the motor command differs from the card there);
//  - the line is in all four simulator languages with both numbers (control: a dictionary without it is caught).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileParams, hoverSolve } from '@gsfpv/sim-core';
import type { PresetJson, SimParams } from '@gsfpv/sim-core';
import { REPO, PRESETS } from '../../../packages/prefs/test/helpers';
import { HOVER_LOW_SOC, cardHover } from '../../../apps/fly/src/ui/drone-card';

const sp = (id: string): SimParams => compileParams(PRESETS.find((p) => p.id === id) as unknown as PresetJson);
/** the picker card's formula before review R3 */
const oldCard = (s: SimParams): number => Math.round(((1 / Math.sqrt(s.twr) - s.idle) / (1 - s.idle)) * 100);
/** the predicate: the card's full-pack number is the full-pack hover stick within a point */
const showsFullPack = (card: number, s: SimParams): boolean => Math.abs(card - hoverSolve(s, 1).stick * 100) <= 1;

describe('drone card hover throttle (review R3)', () => {
    it('every drone: full pack and near empty from sim-core\'s hover solution, full below near empty', () => {
        expect(PRESETS.length).toBe(9);
        for (const p of PRESETS) {
            const s = sp(p.id);
            const c = cardHover(s);
            expect(c, p.id).not.toBeNull();
            expect(c!.full, p.id).toBe(Math.round(hoverSolve(s, 1).stick * 100));
            expect(c!.low, p.id).toBe(Math.round(hoverSolve(s, HOVER_LOW_SOC).stick * 100));
            expect(c!.full, p.id).toBeLessThan(c!.low);
            expect(showsFullPack(c!.full, s), p.id).toBe(true);
        }
    });

    it('the cinelifter: 41 % on a full pack, 53 % near empty', () => {
        expect(cardHover(sp('taurusx8-komodo-6s'))).toEqual({ full: 41, low: 53 });
        expect(cardHover(sp('nazgulf5v3-6s'))).toEqual({ full: 25, low: 32 });
        expect(cardHover(sp('machr5sport-6s'))).toEqual({ full: 18, low: 23 });
    });

    it('control: the old card formula (1/sqrt(TWR)) fails the full-pack predicate on the new drones, by 6-11 points', () => {
        for (const id of ['taurusx8-komodo-6s', 'nazgulf5v3-6s', 'machr5sport-6s']) {
            const s = sp(id);
            expect(showsFullPack(oldCard(s), s), id).toBe(false);
            expect(oldCard(s) - cardHover(s)!.full, id).toBeGreaterThanOrEqual(6);
        }
        expect(oldCard(sp('taurusx8-komodo-6s'))).toBe(52);
    });

    it('a throttle curve: the Pavo20 Pro 3S card is the stick (28 %), the motor command is higher (control)', () => {
        const s = sp('pavo20pro-3s');
        expect(s.throttle).toEqual({ mid: 65, expo: 20 });
        expect(cardHover(s)!.full).toBe(28);
        expect(Math.round(hoverSolve(s, 1).throttle * 100)).toBeGreaterThan(cardHover(s)!.full + 3);
    });

    it('a drone that cannot hover gets no hover line (thrust below its weight)', () => {
        expect(cardHover(compileParams(PRESETS.find((p) => p.id === 'taurusx8-komodo-6s') as unknown as PresetJson, { gravity: 9.81 * 4 }))).toBeNull();
    });

    it('the line is in all four languages with both numbers; control: a dictionary without it is caught', () => {
        const dict = (l: string): Record<string, string> => JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'dronetune', `${l}.json`), 'utf8'));
        const has = (d: Record<string, string>): boolean => typeof d['drone.hover'] === 'string' && d['drone.hover'].includes('{full}') && d['drone.hover'].includes('{low}');
        for (const l of ['en', 'es', 'pl', 'ru']) expect(has(dict(l)), l).toBe(true);
        const without = { ...dict('en') };
        delete without['drone.hover'];
        expect(has(without)).toBe(false);
    });
});
