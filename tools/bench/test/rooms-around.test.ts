// Train 1, lane rooms R3: "who is around" (rooms-plan.md 2.7) and the nickname rule (2.5). Controls: a mirrored x gives
// the other side; a turned drone turns the answer; a name the server refuses is refused here too.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NearWatch, nearest, relation, whoLine } from '../../../apps/fly/src/rooms/around';
import type { Quat, Vec3 } from '../../../apps/fly/src/rooms/around';
import { cleanNick, defaultNick, loadNick, saveNick, NICK_KEY } from '../../../apps/fly/src/rooms/nick';

const EN: Record<string, string> = JSON.parse(readFileSync(new URL('../../../packages/i18n/locales/fly/rooms/en.json', import.meta.url), 'utf8'));
const t = (k: string, v?: Record<string, string | number>): string => {
    let s = EN[k] ?? k;
    for (const [a, b] of Object.entries(v ?? {})) s = s.split(`{${a}}`).join(String(b));
    return s;
};
const LEVEL: Quat = [0, 0, 0, 1];
/** yaw by `deg` about +y (a left turn for a drone looking along -z) */
const yaw = (deg: number): Quat => {
    const r = (deg * Math.PI) / 360;
    return [0, Math.sin(r), 0, Math.cos(r)];
};
const O: Vec3 = [0, 0, 0];

describe('who is around: side and height from two positions', () => {
    it('a level drone looks along -z: +x is right, -z ahead, +y above', () => {
        expect(relation(O, LEVEL, [5, 0, 0])).toMatchObject({ side: 'right', height: 'level' });
        expect(relation(O, LEVEL, [0, 0, -6])).toMatchObject({ side: 'ahead', metres: 6 });
        expect(relation(O, LEVEL, [0.5, 0, 6])).toMatchObject({ side: 'behind' });
        expect(relation(O, LEVEL, [1, 3, -4])).toMatchObject({ side: 'ahead', height: 'above' });
        expect(relation(O, LEVEL, [1, -3, -4]).height).toBe('below');
    });

    it('control: the mirrored x gives the other side', () => {
        expect(relation(O, LEVEL, [-5, 0, 0]).side).toBe('left');
        expect(relation([2, 0, 0], LEVEL, [7, 0, 1]).side).toBe('right');
        expect(relation([2, 0, 0], LEVEL, [-3, 0, 1]).side).toBe('left');
    });

    it('control: the own heading counts: turned 90 degrees left, what was ahead is right', () => {
        expect(relation(O, yaw(90), [0, 0, -6]).side).toBe('right');
        expect(relation(O, yaw(-90), [0, 0, -6]).side).toBe('left');
        expect(relation(O, yaw(180), [0, 0, -6]).side).toBe('behind');
    });

    it('the line: nearest first, at most three; nobody says so', () => {
        const others = [
            { slot: 3, nick: 'Far', pos: [0, 0, -40] as Vec3 },
            { slot: 1, nick: 'Anna', pos: [-6, 2, 0] as Vec3 },
            { slot: 2, nick: 'Bo', pos: [0, 0, 10] as Vec3 },
            { slot: 4, nick: 'Cy', pos: [0, 0, -12] as Vec3 }
        ];
        const near = nearest(O, LEVEL, others);
        expect(near.map((n) => n.nick)).toEqual(['Anna', 'Bo', 'Cy']);
        const line = whoLine(near, t);
        expect(line.key).toBe('rooms.say.who');
        expect(line.text).toBe('Anna, 6 metres, left, above. Bo, 10 metres, behind, same height. Cy, 12 metres, ahead, same height.');
        expect(whoLine([], t)).toEqual({ key: 'rooms.say.nobody', text: 'Nobody else is flying here.' });
    });

    it('the near call: once when closer than 3 m, again only after 5 m', () => {
        const w = new NearWatch();
        const at = (z: number) => nearest(O, LEVEL, [{ slot: 1, nick: 'A', pos: [0, 0, z] }], Infinity);
        expect(w.update(at(-10))).toHaveLength(0);
        expect(w.update(at(-2))).toHaveLength(1);
        expect(w.update(at(-1))).toHaveLength(0);
        expect(w.update(at(-4))).toHaveLength(0);
        expect(w.update(at(-2))).toHaveLength(0);
        expect(w.update(at(-6))).toHaveLength(0);
        expect(w.update(at(-2))).toHaveLength(1);
    });
});

describe('the nickname rule (rooms-plan.md 2.5, as apps/rooms/protocol.py clean_nick)', () => {
    it('keeps letters of any script, digits, space and - _ . \'', () => {
        expect(cleanNick('  Ala  Ma  ')).toBe('Ala Ma');
        // written with code points: no Cyrillic or Polish letters outside the locales (gate B18)
        const anna = String.fromCodePoint(0x410, 0x43d, 0x43d, 0x430) + '-2';
        expect(cleanNick(anna)).toBe(anna);
        const lukasz = String.fromCodePoint(0x141) + "ukasz_O'Neil.";
        expect(cleanNick(lukasz)).toBe(lukasz);
        // NFC: a + combining ring is one letter
        expect(cleanNick('Ma' + String.fromCodePoint(0x30a) + 'ts')).toBe('M' + String.fromCodePoint(0xe5) + 'ts');
    });

    it('control: refuses what the server refuses', () => {
        for (const bad of ['A', 'x'.repeat(21), 'a<b', 'http://x', 'www.site', '--__', 'Ad Min', 'GSFPV pilot', 'tab\tx', 'emoji\u{1F600}', 42, null]) {
            expect(cleanNick(bad), String(bad)).toBeNull();
        }
    });

    it('the default is Pilot- and four digits; a kept bad name is replaced', () => {
        expect(defaultNick(() => 0.0042)).toBe('Pilot-0042');
        expect(defaultNick(() => 0.99999)).toBe('Pilot-9999');
        expect(cleanNick(defaultNick())).not.toBeNull();
        const m = new Map<string, string>();
        const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
        expect(loadNick(store, () => 0.1234)).toEqual({ nick: 'Pilot-1234', asked: false });
        expect(saveNick(store, 'admin')).toBeNull();
        expect(m.has(NICK_KEY)).toBe(false);
        expect(saveNick(store, ' Ola ')).toBe('Ola');
        expect(loadNick(store)).toEqual({ nick: 'Ola', asked: true });
        m.set(NICK_KEY, 'moderator');
        expect(loadNick(store, () => 0).nick).toBe('Pilot-0000');
    });
});
