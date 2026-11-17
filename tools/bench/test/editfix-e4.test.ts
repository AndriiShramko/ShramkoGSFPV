// Lane editfix E4 (docs/wip/editfix.md, finding 1 of the check E3): after Shift+B in the air a keyboard pilot could not start
// the test flight inside the edit mode (the drone stayed armed with the hold set, Space only asked for the arm) and a held
// Space flew the drone unseen under the edit view. The editor now stops the keyboard game pilot's motors when it opens in
// the air; a pad or radio (the keyboard passive) keeps its own switch. Each test fails on the code of efd17add.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Fn = (e: unknown) => void;

describe('editfix E4: the editor opened in the air stops the keyboard pilot', () => {
    const on: Record<string, Fn> = {};
    beforeEach(() => {
        class Dummy {}
        vi.stubGlobal('HTMLInputElement', Dummy);
        vi.stubGlobal('HTMLTextAreaElement', Dummy);
        vi.stubGlobal('HTMLSelectElement', Dummy);
        vi.stubGlobal('HTMLElement', Dummy);
        vi.stubGlobal('Element', Dummy);
        vi.stubGlobal('addEventListener', (type: string, f: Fn) => { on[type] = f; });
        vi.stubGlobal('dispatchEvent', (e: Event) => { on[e.type]?.(e); return true; });
        vi.stubGlobal('window', { setInterval: () => 0 });
        // the edit view is shown (not flying in the mode)
        vi.stubGlobal('document', {
            addEventListener: () => undefined,
            querySelector: (sel: string) => (sel.endsWith('.course-editor:not(.ce-flying)') ? {} : null)
        });
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    const make = async (active: boolean) => {
        const mod = await import('../../../apps/fly/src/devices/keyboard');
        const stop = vi.fn();
        const request = vi.fn();
        const send = vi.fn();
        const kb = new mod.KeyboardSource({} as never);
        kb.profile = 'easy';
        kb.game = { pilot: { arm: { stop, request }, send, look: () => undefined } as never, sensitivity: () => 1, invertY: () => false };
        kb.setActive(active);
        return { mod: mod as Record<string, unknown>, stop, request };
    };

    it('the keyboard game pilot: the motors stop, and the next Space asks for the arm again (one press flies)', async () => {
        const { mod, stop, request } = await make(true);
        expect(typeof mod.stopKeyboardArm).toBe('function');
        (mod.stopKeyboardArm as () => void)();
        expect(stop).toHaveBeenCalledTimes(1);
        on.keydown!({ code: 'Space', key: ' ', timeStamp: 10, repeat: false, target: null, preventDefault: () => undefined });
        expect(request).toHaveBeenCalled();
    });

    it('another source flies (the keyboard passive): its switch is left alone', async () => {
        const { mod, stop } = await make(false);
        expect(typeof mod.stopKeyboardArm).toBe('function');
        (mod.stopKeyboardArm as () => void)();
        expect(stop).not.toHaveBeenCalled();
    });

    it('course.ts openEdit calls it when the drone was armed (the same condition as the move to the start)', () => {
        const src = readFileSync(join(__dirname, '../../../apps/fly/src/app/builtin/course.ts'), 'utf8');
        expect(src).toMatch(/if \(os\.respawn\) ctx\.session\.respawnStart\(\);[\s\S]{0,200}if \(os\.respawn\) stopKeyboardArm\(\);/);
    });
});

// Finding 2 of the check E3: P and Shift+T did nothing and said nothing in the edit view (course.ts blocks the app's keys).
// A block now hears the routed key it swallowed, and the editor says one line: why, and what to press.
describe('editfix E4: a key the edit view swallows says why', () => {
    const press = (p: { code: string; shiftKey?: boolean; repeat?: boolean; defaultPrevented?: boolean }): KeyboardEvent =>
        ({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null, defaultPrevented: false, preventDefault() { /* */ }, ...p }) as unknown as KeyboardEvent;

    it('P and Shift+T reach the refusal with their action; Esc, a repeat and a key a screen took do not', async () => {
        class Dummy {}
        for (const n of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLElement', 'Element']) vi.stubGlobal(n, Dummy);
        const { KeyRouter } = await import('../../../apps/fly/src/app/keys');
        const r = new KeyRouter();
        const ran = vi.fn();
        r.on('pause.toggle', ran);
        r.on('course.toggle', ran);
        const heard: string[] = [];
        (r.block as (b: () => boolean, f: (a: string) => void) => () => void)(() => true, (a) => { heard.push(a); });
        expect(r.route(press({ code: 'KeyP' }))).toBeNull();
        expect(r.route(press({ code: 'KeyT', shiftKey: true }))).toBeNull();
        r.route(press({ code: 'Escape' }));
        r.route(press({ code: 'KeyP', repeat: true }));
        r.route(press({ code: 'KeyP', defaultPrevented: true }));
        expect(ran).not.toHaveBeenCalled();
        expect(heard).toEqual(['pause.toggle', 'course.toggle']);
        vi.unstubAllGlobals();
    });

    it('course.ts gives the edit view its line, in all four languages', () => {
        const src = readFileSync(join(__dirname, '../../../apps/fly/src/app/builtin/course.ts'), 'utf8');
        expect(src).toMatch(/ctx\.keys\.block\(\(\) => ed !== null && mode === 'edit', \(a, e\) => \{\s*const l = keyOffLine\(a, keyName\(e\)\);\s*say\(t\(l\.key, l\.vars\), true\);/);
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const j = JSON.parse(readFileSync(join(__dirname, `../../../packages/i18n/locales/fly/course/${lang}.json`), 'utf8')) as Record<string, string>;
            expect(j['course.edit.keyOff'], lang).toContain('{key}');
            expect(j['course.edit.keyOff'], lang).toContain('Esc');
        }
    });
});

// review 1 of lane editfix, measured on the release of b43c2a48 (1536x730, ?render=off): Shift+B pressed in the edit view
// said 'Shift+B works in flight, not in the editor: press Esc to leave the editor, then Shift+B.', i.e. leave and come back
// into the same editor. Shift+B now repeats the editor's own line; every other swallowed flight key keeps the keyOff line.
describe('editfix review 1: Shift+B in the edit view does not send the pilot out and back in', () => {
    it('keyOffLine gives Shift+B the editor line and P, Shift+T the keyOff line', async () => {
        const { keyOffLine } = await import('../../../apps/fly/src/course/editor/keys');
        expect(keyOffLine('course.edit', 'Shift+B')).toEqual({ key: 'course.edit.opened' });
        expect(keyOffLine('pause.toggle', 'P')).toEqual({ key: 'course.edit.keyOff', vars: { key: 'P' } });
        expect(keyOffLine('course.toggle', 'Shift+T')).toEqual({ key: 'course.edit.keyOff', vars: { key: 'Shift+T' } });
    });
});

// finding 3 of the check E3, measured (U:/Temp/gsfpv-train3/editfix/verify2/touch1536.json, 1536x730 touch): the second
// Exit tap went down on Exit at x 771-815, pointerup cleared the held line (its width 340 -> 420 px), Exit moved to 730-775
// and the tap's click landed on the line. The line now has a fixed basis, so its text never changes the bar's width.
describe('editfix E4.2: the bar keeps its width when the line changes', () => {
    it('the line of the top bar has a fixed flex basis, not the width of its text', () => {
        const css = readFileSync(join(__dirname, '../../../apps/fly/src/course/editor/editor.css'), 'utf8');
        const rule = /\.ce-topbar \.ce-tb-line \{([^}]*)\}/.exec(css);
        expect(rule).not.toBeNull();
        const body = rule![1].replace(/\/\*[\s\S]*?\*\//g, '');
        const flex = /(^|[\s;])flex:\s*([^;]+);/.exec(body);
        expect(flex?.[2].trim()).toBe('0 1 420px');
        // the bar is placed (absolute) and sized by its items' max-content: the width must be set too (measured 340 px without)
        expect(/(^|[\s;])width:\s*420px;/.exec(body)).not.toBeNull();
    });
});
