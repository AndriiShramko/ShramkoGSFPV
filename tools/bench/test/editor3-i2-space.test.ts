// Lane editor3, train 3 stage I2-clean (D8, docs/wip/editor3.md): the keyboard test flight inside the edit mode. Space is the
// game scheme's only climb key, so while the course is flown in the mode a held Space climbs and a short tap goes back to
// editing; the press that armed the drone in the edit view is not taken as that tap when it is let go.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Fn = (e: unknown) => void;

describe('editor3 I2 Space in the edit test flight (D8)', () => {
    let state: 'edit' | 'fly' = 'edit';
    const on: Record<string, Fn> = {};
    beforeEach(() => {
        state = 'edit';
        class Dummy {}
        vi.stubGlobal('HTMLInputElement', Dummy);
        vi.stubGlobal('HTMLTextAreaElement', Dummy);
        vi.stubGlobal('HTMLSelectElement', Dummy);
        vi.stubGlobal('HTMLElement', Dummy);
        vi.stubGlobal('Element', Dummy);
        vi.stubGlobal('addEventListener', (type: string, f: Fn) => { on[type] = f; });
        vi.stubGlobal('window', { setInterval: () => 0 });
        vi.stubGlobal('document', {
            addEventListener: () => undefined,
            querySelector: (sel: string) => {
                if (state === 'fly') return sel === '.course-editor.ce-flying' ? {} : null;
                return sel.endsWith('.course-editor:not(.ce-flying)') ? {} : null;
            }
        });
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    const make = async (): Promise<{ stop: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }> => {
        const { KeyboardSource } = await import('../../../apps/fly/src/devices/keyboard');
        const stop = vi.fn();
        const request = vi.fn();
        const send = vi.fn();
        const kb = new KeyboardSource({} as never);
        kb.profile = 'easy';
        kb.game = { pilot: { arm: { stop, request }, send, look: () => undefined } as never, sensitivity: () => 1, invertY: () => false };
        kb.setActive(true);
        return { stop, request, send };
    };
    const key = (type: 'keydown' | 'keyup', t: number): void => on[type]!({ code: 'Space', key: ' ', timeStamp: t, repeat: false, target: null, preventDefault: () => undefined });

    it('the arming Space in the edit view is not a tap when it is let go after the flight began', async () => {
        const { stop, request } = await make();
        key('keydown', 0);
        expect(request).toHaveBeenCalled();
        state = 'fly';
        key('keyup', 60);
        expect(stop).not.toHaveBeenCalled();
    });

    it('a held Space while flying in the mode climbs and does not disarm', async () => {
        const { stop, send } = await make();
        state = 'fly';
        key('keydown', 1000);
        expect(stop).not.toHaveBeenCalled();
        const last = send.mock.calls.at(-1)?.[0] as { lift: number };
        expect(last.lift).toBe(1);
        key('keyup', 1600);
        expect(stop).not.toHaveBeenCalled();
        expect((send.mock.calls.at(-1)?.[0] as { lift: number }).lift).toBe(0);
    });

    it('a short tap of Space while flying in the mode stops the motors (back to editing)', async () => {
        const { stop } = await make();
        state = 'fly';
        key('keydown', 2000);
        key('keyup', 2080);
        expect(stop).toHaveBeenCalledTimes(1);
    });
});
