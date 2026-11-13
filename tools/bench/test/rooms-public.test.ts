// Lane rooms-public (docs/wip/rooms-public.md): 'Fly with others' in every pilot's menu.
// 1. The menu and the two rooms keys are on every page (ROOMS_MENU_PUBLIC, the keymap lines shipped).
// 2. No key is taken from anyone: on every kind of page (ordinary, ?sonic=), in flight and crashed, with Shift flying (the
//    game scheme's descent) or not, every press routes to the same action as on the table without the rooms lines, except
//    the two rooms keys, which routed nothing before; and every chord of every binding a page lists routes to its own action.
// 3. A room link without ?scene= asks the room for its scan (rooms/link.ts) and boot.ts does so before the picker.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSceneLink } from '../../../packages/scenes/src/link';
import { KEYMAP, keymapProblems } from '../../../packages/prefs/src/keymap';
import type { KeyBinding } from '../../../packages/prefs/src/keymap';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import { roomSceneLink } from '../../../apps/fly/src/rooms/link';

const ROOT = join(__dirname, '..', '..', '..');
const text = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const ev = (code: string, shiftKey: boolean): KeyboardEvent => ({
    code, shiftKey, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null, preventDefault: () => undefined
}) as unknown as KeyboardEvent;

/** Every physical key a pilot may press (KeyboardEvent.code), each with and without Shift. */
const CODES: string[] = [
    ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
    ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
    ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
    'Comma', 'Period', 'Slash', 'Semicolon', 'Quote', 'Backquote', 'Minus', 'Equal', 'Backslash', 'BracketLeft', 'BracketRight',
    'Escape', 'Enter', 'Space', 'Tab', 'Backspace'
];

interface Page { sonic: boolean; shiftFlies: boolean; state: 'flight' | 'crash' }
const PAGES: Page[] = [];
for (const sonic of [false, true]) for (const shiftFlies of [false, true]) for (const state of ['flight', 'crash'] as const) PAGES.push({ sonic, shiftFlies, state });
const name = (p: Page): string => `${p.sonic ? 'sonic' : 'ordinary'} ${p.state}${p.shiftFlies ? ' shift-flies' : ''}`;

/** A router of this kind of page over `map`, with a handler on every action it routes. */
function router(map: readonly KeyBinding[], p: Page): KeyRouter {
    const r = new KeyRouter({ map, sonic: () => p.sonic, shiftIsFlying: () => p.shiftFlies, state: () => p.state, isText: () => false });
    for (const b of map) if (r.routes(b.action)) r.on(b.action, () => undefined);
    return r;
}

/** Every press whose action differs between `before` and `after`, on every kind of page: "page chord: before -> after". */
function changed(before: readonly KeyBinding[], after: readonly KeyBinding[]): string[] {
    const out: string[] = [];
    for (const p of PAGES) {
        const a = router(before, p);
        const b = router(after, p);
        for (const code of CODES) for (const shift of [false, true]) {
            const x = a.route(ev(code, shift));
            const y = b.route(ev(code, shift));
            if (x !== y) out.push(`${name(p)} ${shift ? 'Shift+' : ''}${code}: ${x} -> ${y}`);
        }
    }
    return out;
}

const WITHOUT_ROOMS = KEYMAP.filter((b) => !b.action.startsWith('rooms.'));

describe('1. the rooms menu and keys are public', () => {
    it('ROOMS_MENU_PUBLIC is true and both rooms lines are shipped', () => {
        expect(text('apps/fly/src/app/builtin/rooms.ts')).toMatch(/export const ROOMS_MENU_PUBLIC = true;/);
        expect(KEYMAP.filter((b) => b.action.startsWith('rooms.')).map((b) => [b.action, b.status])).toEqual([['rooms.panel', 'shipped'], ['rooms.who', 'shipped']]);
    });

    it('the spoken lines name the keys in four languages: the welcome names the who-is-around key, "not in a room" the panel key', () => {
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const d = JSON.parse(text(`packages/i18n/locales/fly/rooms/${lang}.json`)) as Record<string, string>;
            expect(d['rooms.say.welcome'], lang).toContain('{who}');
            expect(d['rooms.say.noRoom'], lang).toContain('{panel}');
        }
        const src = text('apps/fly/src/app/builtin/rooms.ts');
        expect(src).toContain("who: keyOf('rooms.who')");
        expect(src).toContain("{ panel: keyOf('rooms.panel') }");
    });

    it('the feature registers its keys through the router (ctx.keys.on), not a capture-phase listener', () => {
        const src = text('apps/fly/src/app/builtin/rooms.ts');
        expect(src).toContain("ctx.keys.on('rooms.panel'");
        expect(src).toContain("ctx.keys.on('rooms.who'");
        expect(src).not.toMatch(/addEventListener\('keydown'|listenRoomsKeys/);
    });
});

describe('2. no key is taken from anyone', () => {
    it('on every kind of page the only presses that changed are 9 and 0, which routed nothing before and now open the rooms', () => {
        const got = changed(WITHOUT_ROOMS, KEYMAP);
        const expected: string[] = [];
        for (const p of PAGES) for (const shift of [false, true]) {
            // a chord no binding has falls back to the key alone only while Shift flies (app/keys.ts route())
            if (shift && !p.shiftFlies) continue;
            expected.push(`${name(p)} ${shift ? 'Shift+' : ''}Digit9: null -> rooms.panel`, `${name(p)} ${shift ? 'Shift+' : ''}Digit0: null -> rooms.who`);
        }
        expect(got.sort()).toEqual(expected.sort());
    });

    it('no chord is bound twice on any kind of page: every chord of every listed binding routes to its own action', () => {
        expect(keymapProblems(KEYMAP)).toEqual([]);
        const wrong: string[] = [];
        for (const p of PAGES) {
            const r = router(KEYMAP, p);
            for (const b of r.listed()) {
                if (b.flying || (b.when !== 'always' && b.when !== 'sonic' && b.when !== p.state)) continue;
                for (const k of b.keys) {
                    const got = r.route(ev(k.code, !!k.shift));
                    if (got !== b.action) wrong.push(`${name(p)} ${k.cap}: ${b.action} -> ${got}`);
                }
            }
        }
        expect(wrong).toEqual([]);
    });

    it('control: train 1\'s reservation (Shift+L, Shift+O) shipped would take share and settings from a pilot descending with Shift', () => {
        const old = KEYMAP.map((b) => b.action === 'rooms.panel' ? { ...b, keys: [{ code: 'KeyL', shift: true, cap: 'Shift+L', aria: 'Shift+L' }] }
            : b.action === 'rooms.who' ? { ...b, keys: [{ code: 'KeyO', shift: true, cap: 'Shift+O', aria: 'Shift+O' }] } : b);
        const got = changed(WITHOUT_ROOMS, old);
        expect(got).toContain('ordinary flight shift-flies Shift+KeyO: settings.open -> rooms.who');
        expect(got).toContain('ordinary flight shift-flies Shift+KeyL: share.open -> rooms.panel');
    });

    it('control: a rooms key planted on a letter of the sound mode changes a ?sonic= page', () => {
        const planted = KEYMAP.map((b) => b.action === 'rooms.who' ? { ...b, keys: [{ code: 'KeyI', cap: 'I', aria: 'I' }] } : b);
        expect(changed(WITHOUT_ROOMS, planted)).toContain('sonic flight KeyI: sonic.status -> rooms.who');
    });
});

type FakeAnswer = { ok: boolean; status: number; body: unknown } | 'throw';
function fakeFetch(answer: FakeAnswer, asked: string[]): typeof fetch {
    return (async (url: string) => {
        asked.push(String(url));
        if (answer === 'throw') throw new Error('offline');
        return { ok: answer.ok, status: answer.status, json: async () => answer.body } as unknown as Response;
    }) as unknown as typeof fetch;
}

describe('3. a room link without a scene opens the room\'s scan', () => {
    const ROOM = 'Ab3_dE-9xYz';
    const room = (scene: unknown) => ({ id: ROOM, name: 'R', scene, cap: 8, members: 1, listed: false, kind: 'temp', state: 'open', createdAt: 0 });

    it('asks the server for the room and gives the scan with its drawing parameters, as the picker\'s go() reads it', async () => {
        const asked: string[] = [];
        const raw = await roomSceneLink(ROOM, 'http://rig', fakeFetch({ ok: true, status: 200, body: room({ id: '887f27aa', render: { budgetM: 8, stochastic: true } }) }, asked));
        expect(asked).toEqual([`http://rig/api/rooms/${ROOM}`]);
        expect(parseSceneLink(raw!)).toEqual({ id: '887f27aa', render: { budgetM: 8, stochastic: true } });
        const bare = await roomSceneLink(ROOM, '', fakeFetch({ ok: true, status: 200, body: room({ id: '39e63ce9' }) }, []));
        expect(bare).toBe('39e63ce9');
    });

    it('no room, a bad id, a room gone, no answer or a scan that is no scene id give null (the picker), a bad id without asking', async () => {
        const asked: string[] = [];
        expect(await roomSceneLink(null, '', fakeFetch({ ok: true, status: 200, body: room({ id: '887f27aa' }) }, asked))).toBeNull();
        expect(await roomSceneLink('../health', '', fakeFetch({ ok: true, status: 200, body: room({ id: '887f27aa' }) }, asked))).toBeNull();
        expect(asked).toEqual([]);
        expect(await roomSceneLink(ROOM, '', fakeFetch({ ok: false, status: 404, body: { error: 'gone' } }, asked))).toBeNull();
        expect(await roomSceneLink(ROOM, '', fakeFetch('throw', asked))).toBeNull();
        expect(await roomSceneLink(ROOM, '', fakeFetch({ ok: true, status: 200, body: room({ id: 'not a scene' }) }, asked))).toBeNull();
        expect(await roomSceneLink(ROOM, '', fakeFetch({ ok: true, status: 200, body: room(null) }, asked))).toBeNull();
    });

    it('boot.ts opens ?scene= as before and asks the room only when there is no ?scene=, before the picker', () => {
        const src = text('apps/fly/src/app/boot.ts');
        const start = src.slice(src.indexOf('const start = ('), src.indexOf('startAnalytics('));
        const scene = start.indexOf("if (sceneParam) go(sceneParam, 'paste', true);");
        const roomAt = start.indexOf("roomSceneLink(q.get('room'))");
        expect(scene).toBeGreaterThan(-1);
        expect(roomAt).toBeGreaterThan(scene);
        expect(start.indexOf('picked()', roomAt)).toBeGreaterThan(roomAt);
    });
});
