// The mode switches of a Betaflight dump (bfaux.ts via parseBetaflightDiff): BetaFPV's real Pavo20
// dumps (ARM on AUX1 or AUX3, ANGLE / HORIZON on one 3-position switch), the `map` line, free slots,
// AND / linked conditions, and lines the firmware cannot print (each refused: negative controls).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auxConditions, boxName, parseAuxLine, parseAuxPaste, parseBetaflightDiff, parseMapLine } from '../src/index';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const D45 = fixture('bf-diff-4.5.1.txt');
const ELRS = fixture('betafpv/pavo20pro-bf450-elrs-20241216.txt');
const SBUS = fixture('betafpv/pavo20pro-bf450-sbus-20250610.txt');
const edit = (text: string, from: string, to: string) => {
    expect(text).toContain(from);
    return text.replace(from, to);
};
const brief = (text: string) => parseBetaflightDiff(text).aux.map((a) => `${a.mode} CH${a.channel} ${a.lo}-${a.hi}${a.and ? ' AND' : ''}${a.linkedTo ? ` -> ${a.linkedTo}` : ''}`);

describe('Betaflight aux lines (Modes tab)', () => {
    it('BetaFPV Pavo20 Pro, ELRS: arm on AUX1 (CH5), angle / horizon on CH6', () => {
        expect(brief(ELRS)).toEqual([
            'ARM CH5 1700-2100', 'ANGLE CH6 900-1300', 'HORIZON CH6 1300-1700', 'BEEPER CH7 1700-2100',
            'FLIP OVER AFTER CRASH CH7 1650-2100', 'USER1 CH8 1400-2100'
        ]);
    });

    it('BetaFPV Pavo20 Pro, SBUS: arm on AUX3 (CH7), angle / horizon on CH5', () => {
        expect(brief(SBUS).slice(0, 3)).toEqual(['ARM CH7 1700-2100', 'ANGLE CH5 900-1300', 'HORIZON CH5 1300-1700']);
    });

    it('the synthetic 4.5.1 diff: two conditions, free slots of diff all skipped', () => {
        expect(brief(D45)).toEqual(['ARM CH5 1800-2100', 'ANGLE CH6 1300-2100']);
        const withFree = edit(D45, 'aux 1 1 1 1300 2100 0 0', 'aux 1 1 1 1300 2100 0 0\naux 2 0 0 900 900 0 0\naux 3 0 0 1500 1500 0 0');
        expect(brief(withFree)).toEqual(['ARM CH5 1800-2100', 'ANGLE CH6 1300-2100']);
    });

    it('AND logic and a linked mode are kept as Betaflight printed them', () => {
        const t = edit(D45, 'aux 1 1 1 1300 2100 0 0', 'aux 1 1 1 1300 2100 1 0\naux 2 1 3 1700 2100 1 0\naux 3 13 0 900 900 0 0\naux 4 28 2 900 900 0 0');
        // slot 3: BEEPER with a free range and no link is unused; slot 4 is not linked either
        expect(brief(t)).toEqual(['ARM CH5 1800-2100', 'ANGLE CH6 1300-2100 AND', 'ANGLE CH8 1700-2100 AND']);
        const linked = edit(D45, 'aux 1 1 1 1300 2100 0 0', 'aux 1 1 1 1300 2100 0 0\naux 2 2 0 900 900 0 1');
        expect(brief(linked)).toContain('HORIZON CH5 900-900 -> ANGLE');
    });

    it('a map line that moves AUX1 and AUX2 moves their channels; sticks-only maps do not', () => {
        const swapped = edit(D45, 'aux 0 0 0 1800 2100 0 0', 'map AETR2134\naux 0 0 0 1800 2100 0 0');
        expect(brief(swapped)).toEqual(['ARM CH6 1800-2100', 'ANGLE CH5 1300-2100']);
        const taer = edit(D45, 'aux 0 0 0 1800 2100 0 0', 'map TAER1234\naux 0 0 0 1800 2100 0 0');
        expect(brief(taer)).toEqual(brief(D45));
        // AUX5 and above are not mappable: physical = logical
        expect(auxConditions([{ slot: 0, modeId: 0, auxIndex: 6, lo: 1700, hi: 2100, logic: 0, linked: 0 }], parseMapLine('map AETR4321') as number[])[0].channel).toBe(11);
        expect(parseMapLine('map AETR4321')).toEqual([0, 1, 3, 2, 7, 6, 5, 4]);
    });

    it('aux and map are read, so they are no longer counted as skipped commands', () => {
        const r = parseBetaflightDiff(D45);
        expect(r.errors).toEqual([]);
        expect(r.ignoredCommands.aux).toBeUndefined();
        expect(boxName(36)).toBe('PREARM');
        expect(boxName(999)).toBe('MODE 999');
    });

    it('negative controls: lines the firmware cannot print refuse the import', () => {
        const bad = [
            ['aux 0 0 0 1800 2100 0 0', 'aux 0 0 0 1810 2100 0 0', /25 us grid/],
            ['aux 0 0 0 1800 2100 0 0', 'aux 0 0 0 1800 2125 0 0', /25 us grid/],
            ['aux 0 0 0 1800 2100 0 0', 'aux 20 0 0 1800 2100 0 0', /slot 20/],
            ['aux 0 0 0 1800 2100 0 0', 'aux 0 0 14 1800 2100 0 0', /aux channel 14/],
            ['aux 0 0 0 1800 2100 0 0', 'aux 0 0 0 1800 2100 2 0', /logic 2/],
            ['aux 0 0 0 1800 2100 0 0', 'aux 0 0 0 1800 2100', /seven whole numbers/],
            ['aux 1 1 1 1300 2100 0 0', 'aux 0 1 1 1300 2100 0 0', /slot 0 appears twice/],
            ['aux 0 0 0 1800 2100 0 0', 'map AETR1134\naux 0 0 0 1800 2100 0 0', /channel map/],
            ['aux 0 0 0 1800 2100 0 0', 'map AETR1234\nmap AETR1234\naux 0 0 0 1800 2100 0 0', /"map" appears twice/]
        ] as const;
        for (const [from, to, msg] of bad) {
            const r = parseBetaflightDiff(edit(D45, from, to));
            expect(r.errors.join(' '), to).toMatch(msg);
            expect(r.rates, to).toBeNull();
        }
        expect(typeof parseAuxLine('aux 0 0 0 1800 2100 0 0')).toBe('object');
    });
});

describe('bare aux lines (the CLI\'s aux command, a diff\'s aux block): parseAuxPaste', () => {
    const block = (text: string) => text.split(/\r?\n/).filter((l) => /^(aux|map)\s/i.test(l.trim())).join('\n');

    it('the aux block of each BetaFPV dump reads as the whole dump does (map included); control: the whole-diff parser refuses the bare lines', () => {
        for (const dump of [ELRS, SBUS, D45]) {
            const bare = block(dump);
            expect(bare).toMatch(/^aux /m);
            const r = parseAuxPaste(`# aux\n${bare}\n`);
            expect(r?.errors).toEqual([]);
            expect(r?.aux).toEqual(parseBetaflightDiff(dump).aux);
            // control: the only path before, the whole-diff parser, finds no version line
            const old = parseBetaflightDiff(bare);
            expect(old.errors.join(' ')).toMatch(/Not a Betaflight diff/);
            expect(old.aux).toEqual([]);
        }
        expect(parseAuxPaste('aux 0 0 0 1700 2100 0 0')?.aux.map((a) => `${a.mode} CH${a.channel} ${a.lo}-${a.hi}`)).toEqual(['ARM CH5 1700-2100']);
    });

    it('the CLI\'s aux command prints all 20 slots: the free ones (start = end) are left out', () => {
        const all = Array.from({ length: 20 }, (_, i) => (i === 0 ? 'aux 0 0 1 1700 2100 0 0' : i === 1 ? 'aux 1 1 0 900 1300 0 0' : `aux ${i} 0 0 900 900 0 0`)).join('\r\n');
        expect(parseAuxPaste(all)?.aux.map((a) => `${a.mode} CH${a.channel}`)).toEqual(['ARM CH6', 'ANGLE CH5']);
    });

    it('negative controls: a line the firmware cannot print or a slot twice is refused; anything else is a whole diff (null)', () => {
        expect(parseAuxPaste('aux 0 0 0 1810 2100 0 0')?.errors.join(' ')).toMatch(/25 us grid/);
        expect(parseAuxPaste('aux 0 0 0 1810 2100 0 0')?.aux).toEqual([]);
        expect(parseAuxPaste('aux 0 0 0 1700 2100 0 0\naux 0 1 1 900 1300 0 0')?.errors.join(' ')).toMatch(/slot 0 appears twice/);
        expect(parseAuxPaste('map AETR1234\nmap TAER1234\naux 0 0 0 1700 2100 0 0')?.errors.join(' ')).toMatch(/"map" appears twice/);
        expect(parseAuxPaste(D45)).toBeNull();
        expect(parseAuxPaste('aux 0 0 0 1700 2100 0 0\nset roll_rc_rate = 120')).toBeNull();
        expect(parseAuxPaste('map AETR1234')).toBeNull();
        expect(parseAuxPaste('')).toBeNull();
    });
});
