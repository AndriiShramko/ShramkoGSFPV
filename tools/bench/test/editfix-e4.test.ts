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
