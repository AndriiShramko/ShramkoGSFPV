// Train 1, lane rooms: findings of the level 2 review (docs/wip/rooms.md, "R review fixes").
// RV-1: every page keeps Shift+O = settings and Shift+L = share for a pilot who holds Shift to descend; since lane
// rooms-public the rooms keys are 9 and 0, routed by the page's router. RV-6: a hostile pose cannot flood a blind pilot's speech.
import { describe, expect, it } from 'vitest';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import { LineBudget, NearWatch, nearest, whoLine } from '../../../apps/fly/src/rooms/around';
import type { Near, Quat } from '../../../apps/fly/src/rooms/around';

const ev = (code: string, shiftKey: boolean): KeyboardEvent => ({
    code, shiftKey, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null,
    preventDefault: () => undefined, stopImmediatePropagation: () => undefined
}) as unknown as KeyboardEvent;

describe('RV-1: the rooms keys on every page (lane rooms-public: the feature is public, its keys 9 and 0)', () => {
    it('Shift held to descend plus O opens the settings and plus L shares, with the rooms handlers on the page too; 9 and 0 are the rooms keys', () => {
        const r = new KeyRouter({ shiftIsFlying: () => true, isText: () => false });
        const ran: string[] = [];
        for (const a of ['settings.open', 'share.open', 'rooms.panel', 'rooms.who']) r.on(a, () => { ran.push(a); });
        expect([r.route(ev('KeyO', true)), r.route(ev('KeyL', true)), r.route(ev('Digit9', false)), r.route(ev('Digit0', false)), r.route(ev('Digit0', true))])
            .toEqual(['settings.open', 'share.open', 'rooms.panel', 'rooms.who', 'rooms.who']);
        expect(ran).toEqual(['settings.open', 'share.open', 'rooms.panel', 'rooms.who', 'rooms.who']);
    });

    it('the key list of an ordinary page lists the two rooms keys with their caps 9 and 0', () => {
        const r = new KeyRouter();
        expect(r.listed().map((b) => b.action).filter((a) => a.startsWith('rooms.'))).toEqual(['rooms.panel', 'rooms.who']);
        expect([r.caps('rooms.panel'), r.caps('rooms.who')]).toEqual([[{ cap: '9', aria: '9' }], [{ cap: '0', aria: '0' }]]);
    });
});

const LEVEL: Quat = [0, 0, 0, 1];
const at = (x: number): Near[] => nearest([0, 0, 0], LEVEL, [{ slot: 1, nick: 'Eve', pos: [x, 0, 0] }], Infinity);

describe('RV-6: what a hostile pose can make a blind pilot hear', () => {
    it('a pose swinging 2 m / 6 m every 250 ms for 60 s gives one near call per 10 s, not one per swing', () => {
        const run = (w: NearWatch): number => {
            let said = 0;
            for (let i = 0; i < 240; i++) said += w.update(at(i % 2 === 0 ? 2 : 6), i * 250).length;
            return said;
        };
        expect(run(new NearWatch())).toBeLessThanOrEqual(6);
        expect(run(new NearWatch(3, 5, 0))).toBe(120); // control: without the pause every second check calls
    });

    it('a position far out of any scan is not said (Shift+O says nobody, not 5e38 metres)', () => {
        const t = (k: string): string => k;
        expect(whoLine(nearest([0, 0, 0], LEVEL, [{ slot: 1, nick: 'Eve', pos: [3e38, 3e38, 3e38] }]), t).key).toBe('rooms.say.nobody');
        expect(whoLine(nearest([0, 0, 0], LEVEL, [{ slot: 1, nick: 'Eve', pos: [6, 0, 0] }]), t).key).toBe('rooms.say.who'); // control
    });

    it('room lines are capped per minute: 40 joins and leaves in a minute say at most 12', () => {
        const b = new LineBudget();
        let said = 0;
        for (let i = 0; i < 40; i++) said += b.take(i * 1500) ? 1 : 0;
        expect(said).toBe(12);
        expect(b.take(60_000 + 1)).toBe(true); // control: a minute later lines are said again
    });
});
