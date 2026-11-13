// Train 1, lane rooms: findings of the level 2 review (docs/wip/rooms.md, "R review fixes").
// RV-1: an ordinary page keeps Shift+O = settings and Shift+L = share for a pilot who holds Shift to descend, and lists no
// rooms keys; a rooms page takes the two chords before the router. RV-6: a hostile pose cannot flood a blind pilot's speech.
import { describe, expect, it } from 'vitest';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import { LineBudget, NearWatch, nearest, whoLine } from '../../../apps/fly/src/rooms/around';
import type { Near, Quat } from '../../../apps/fly/src/rooms/around';
import { listenRoomsKeys, roomsChord } from '../../../apps/fly/src/rooms/keys';

const ev = (code: string, shiftKey: boolean): KeyboardEvent => ({
    code, shiftKey, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null,
    preventDefault: () => undefined, stopImmediatePropagation: () => undefined
}) as unknown as KeyboardEvent;

describe('RV-1: the rooms keys on an ordinary page', () => {
    it('Shift held to descend plus O opens the settings and plus L shares, with no rooms handler on the page', () => {
        const r = new KeyRouter({ shiftIsFlying: () => true, isText: () => false });
        const ran: string[] = [];
        r.on('settings.open', () => { ran.push('settings.open'); });
        r.on('share.open', () => { ran.push('share.open'); });
        expect(r.route(ev('KeyO', true))).toBe('settings.open');
        expect(r.route(ev('KeyL', true))).toBe('share.open');
        expect(ran).toEqual(['settings.open', 'share.open']);
    });

    it('the key list of an ordinary page has no rooms key while the feature is hidden', () => {
        expect(new KeyRouter().listed().map((b) => b.action).filter((a) => a.startsWith('rooms.'))).toEqual([]);
    });

    it('a rooms page takes Shift+L and Shift+O before the router (capture phase) and only those', () => {
        expect([roomsChord(ev('KeyL', true)), roomsChord(ev('KeyO', true)), roomsChord(ev('KeyO', false)), roomsChord({ code: 'KeyO', shiftKey: true, ctrlKey: true })])
            .toEqual(['rooms.panel', 'rooms.who', null, null]);
        let listener: ((e: Event) => void) | null = null;
        let capture: unknown = null;
        const target = {
            addEventListener: (_t: string, f: (e: Event) => void, c: unknown) => { listener = f; capture = c; },
            removeEventListener: () => { listener = null; }
        } as unknown as EventTarget;
        const got: string[] = [];
        const off = listenRoomsKeys(target, (a) => { got.push(a); return true; });
        expect(capture).toBe(true);
        let stopped = 0;
        const e = { ...ev('KeyO', true), stopImmediatePropagation: () => { stopped++; } } as unknown as Event;
        listener!(e);
        listener!(ev('KeyO', false) as unknown as Event);
        expect([got, stopped]).toEqual([['rooms.who'], 1]);
        off();
        expect(listener).toBeNull();
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
