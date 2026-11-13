// Lane rooms-public, level 2 review fixes (docs/wip/rooms-public.md, "R review fixes").
// RP-1 A running sound lesson takes every digit before the router (sonic/digit-key.ts): the real digit handler and the real router
//      on one window show it; the welcome line said during a lesson says 0 works after the lesson, and after it 0 reaches rooms.
// RP-2 Both rooms keys stop the key's default action (9 must not type itself into the panel's name field).
// RP-3 9 waits while a dialog is up (the sound mode's start screen and lesson menu too); 0 without a room is silent under a dialog,
//      0 inside a room answers everywhere.
// RP-4 The room link gives up after its time limit and passes fetch a signal.
// RP-5 boot.ts's first scene (scene link / room link / picker) as a function, with fake answers.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digitAnswerHandler } from '../../../apps/fly/src/sonic/digit-key';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import { roomKeys, welcomeLine } from '../../../apps/fly/src/rooms/keys';
import { openFirst, roomSceneLink } from '../../../apps/fly/src/rooms/link';

const ROOT = join(__dirname, '..', '..', '..');

interface Pressed { prevented: boolean }

/** One target (the window): capture listeners first, then bubble ones, unless a listener stopped the propagation. */
function fakeWindow() {
    const ls: { fn: (e: unknown) => void; capture: boolean }[] = [];
    return {
        addEventListener(_t: string, fn: (e: unknown) => void, o?: boolean | AddEventListenerOptions): void {
            ls.push({ fn, capture: o === true || (typeof o === 'object' && o.capture === true) });
        },
        removeEventListener(): void { /* not needed */ },
        press(code: string): Pressed {
            let stopped = false;
            const out: Pressed = { prevented: false };
            const e = {
                code, key: code.replace(/^Digit/, ''), shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null,
                preventDefault: () => { out.prevented = true; },
                stopPropagation: () => { stopped = true; },
                stopImmediatePropagation: () => { stopped = true; }
            };
            for (const l of ls) if (l.capture && !stopped) l.fn(e);
            if (!stopped) for (const l of ls) if (!l.capture) l.fn(e);
            return out;
        }
    };
}

interface Opts { lesson: boolean; paused: boolean; dialog: boolean; room: boolean }

/** The page as far as the two keys go: the sound mode's digit listener (sonic/feature.ts), the router with the rooms handlers (builtin/rooms.ts). */
function page(o: Opts) {
    const win = fakeWindow();
    const answers: number[] = [];
    const did: string[] = [];
    win.addEventListener('keydown', digitAnswerHandler({
        host: () => ({ active: o.lesson, asking: false, answer: (n: number) => { answers.push(n); return true; } }) as never,
        paused: () => o.paused,
        typing: () => false
    }) as (e: unknown) => void, true);
    const r = new KeyRouter({ sonic: () => true, isText: () => false });
    const rk = roomKeys({
        dialogUp: () => o.dialog,
        inRoom: () => o.room,
        openPanel: () => did.push('panel'),
        sayWho: () => did.push('who'),
        sayNoRoom: () => did.push('noRoom')
    });
    r.on('rooms.panel', rk.panel.run, rk.panel.opts);
    r.on('rooms.who', rk.who.run, rk.who.opts);
    r.attach(win as unknown as Window);
    return { win, answers, did };
}

const FLY: Opts = { lesson: false, paused: false, dialog: false, room: true };

describe('RP-1: the rooms keys and a running sound lesson', () => {
    it('no lesson: 9 opens the panel, 0 says who is around', () => {
        const p = page(FLY);
        p.win.press('Digit9');
        p.win.press('Digit0');
        expect([p.answers, p.did]).toEqual([[], ['panel', 'who']]);
    });

    it('a lesson running: both digits are the lesson\'s answers and rooms hears neither', () => {
        const p = page({ ...FLY, lesson: true });
        p.win.press('Digit9');
        p.win.press('Digit0');
        expect([p.answers, p.did]).toEqual([[9, 0], []]);
    });

    it('the lesson over (no lesson running any more): 0 reaches rooms again, as the lesson line promises', () => {
        const o = { ...FLY, lesson: true };
        const p = page(o);
        p.win.press('Digit0');
        o.lesson = false;
        p.win.press('Digit0');
        expect([p.answers, p.did]).toEqual([[0], ['who']]);
    });

    it('the welcome line during a lesson is the lesson line; without a lesson the plain line', () => {
        expect(welcomeLine(true, 'R', 2, '0')).toEqual({ key: 'rooms.say.welcomeLesson', params: { name: 'R', n: 2, who: '0' } });
        expect(welcomeLine(false, 'R', 2, '0')).toEqual({ key: 'rooms.say.welcome', params: { name: 'R', n: 2, who: '0' } });
    });

    it('the lesson line in en es pl ru names the room, the count and {who}; the key list says not in a lesson; the wait line exists', () => {
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const loc = JSON.parse(readFileSync(join(ROOT, 'packages/i18n/locales/fly/rooms', `${lang}.json`), 'utf8')) as Record<string, string>;
            const s = loc['rooms.say.welcomeLesson'] ?? '';
            for (const v of ['{name}', '{n}', '{who}']) expect(s, `${lang} ${v}`).toContain(v);
            expect(s, lang).not.toBe(loc['rooms.say.welcome']);
            expect(loc['keys.rooms.who'], lang).not.toBe(loc['keys.rooms.who']?.split(' (')[0]);
            expect(loc['keys.rooms.panel'], lang).not.toBe(loc['keys.rooms.panel']?.split(' (')[0]);
            expect((loc['rooms.link.wait'] ?? '').length, lang).toBeGreaterThan(3);
        }
    });
});

describe('RP-2: the rooms keys stop the default action', () => {
    it('9 and 0 are prevented (no 9 typed into the name field the panel focuses)', () => {
        const p = page(FLY);
        expect([p.win.press('Digit9').prevented, p.win.press('Digit0').prevented]).toEqual([true, true]);
    });
});

describe('RP-3: the rooms keys and the windows on top', () => {
    it('a dialog up: 9 does nothing, 0 without a room says nothing and is not prevented', () => {
        const p = page({ ...FLY, dialog: true, room: false });
        const a = p.win.press('Digit9');
        const b = p.win.press('Digit0');
        expect([p.did, a.prevented, b.prevented]).toEqual([[], false, false]);
    });

    it('a dialog up inside a room: 0 still answers; with no dialog and no room 0 says how to join', () => {
        const p = page({ ...FLY, dialog: true });
        p.win.press('Digit0');
        const q = page({ ...FLY, room: false });
        q.win.press('Digit0');
        expect([p.did, q.did]).toEqual([['who'], ['noRoom']]);
    });

    it('builtin/rooms.ts asks dialogOpen() (start screen, lesson menu) besides the #ui screens and panels', () => {
        const src = readFileSync(join(ROOT, 'apps/fly/src/app/builtin/rooms.ts'), 'utf8');
        expect(src).toMatch(/dialogUp: \(\) => dialogOpen\(\) \|\| !!document\.querySelector\('#ui \.screen, #ui \.panel'\)/);
    });
});

describe('RP-4: the room link has a time limit', () => {
    it('a service that never answers: null after the limit, and fetch got a signal', async () => {
        const inits: (RequestInit | undefined)[] = [];
        const never = ((_u: string, init?: RequestInit) => { inits.push(init); return new Promise<Response>(() => undefined); }) as unknown as typeof fetch;
        const raw = await roomSceneLink('Ab3_dE-9xYz', '', never, 50);
        expect(raw).toBe(null);
        expect(inits[0]?.signal instanceof AbortSignal).toBe(true);
    }, 2000);
});

describe('RP-5: boot.ts\'s first scene', () => {
    const run = async (scene: string | null, room: string | null, ask?: (r: string) => Promise<string | null>) => {
        const log: string[] = [];
        const p = openFirst(scene, room, {
            go: (raw) => log.push(`go ${raw}`),
            picker: () => log.push('picker'),
            waiting: (on) => log.push(`wait ${on}`),
            ...(ask ? { ask } : {})
        });
        const sync = [...log];
        await p;
        return { sync, log };
    };

    it('a scene link opens in the same task and never asks', async () => {
        let asked = 0;
        const r = await run('39e63ce9', 'Ab3_dE-9xYz', async () => { asked++; return 'x'; });
        expect([r.sync, asked]).toEqual([['go 39e63ce9'], 0]);
    });

    it('a room link: the wait line, then the room\'s scan', async () => {
        expect((await run(null, 'Ab3_dE-9xYz', async () => '39e63ce9?q=1')).log).toEqual(['wait true', 'wait false', 'go 39e63ce9?q=1']);
    });

    it('a room the server does not have, and a failed ask: the picker', async () => {
        expect((await run(null, 'Ab3_dE-9xYz', async () => null)).log).toEqual(['wait true', 'wait false', 'picker']);
        expect((await run(null, 'Ab3_dE-9xYz', () => Promise.reject(new Error('x')))).log).toEqual(['wait true', 'wait false', 'picker']);
    });

    it('no link: the picker at once', async () => {
        expect((await run(null, null)).sync).toEqual(['picker']);
    });

    it('boot.ts starts through openFirst', () => {
        expect(readFileSync(join(ROOT, 'apps/fly/src/app/boot.ts'), 'utf8')).toMatch(/openFirst\(sceneParam, q\.get\('room'\)/);
    });
});
