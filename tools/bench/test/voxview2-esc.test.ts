// Lane voxview2 V7: Esc with the voxel panel open closes the panel and nothing else, also when another listener (the
// edit mode's, course/editor/view-mouse.ts) sits on the window in the capture phase after the panel's.
import { describe, expect, it } from 'vitest';
import * as vp from '../../../apps/fly/src/ui/voxel-panel';

function esc(): KeyboardEvent {
    const e = new Event('keydown', { cancelable: true });
    Object.defineProperty(e, 'key', { value: 'Escape' });
    return e as KeyboardEvent;
}

type Make = (isOpen: () => boolean, close: () => void) => (e: KeyboardEvent) => void;
const make = (): Make | undefined => (vp as unknown as { panelEsc?: Make }).panelEsc;

describe('voxview2 V7: Esc closes the top thing only', () => {
    it('the panel open: the panel closes, the edit mode does not see the Esc', () => {
        const win = new EventTarget();
        let open = true;
        let editSaw = 0;
        const f = make();
        expect(typeof f).toBe('function');
        win.addEventListener('keydown', f!(() => open, () => { open = false; }) as EventListener, true);
        win.addEventListener('keydown', () => { editSaw++; }, true);
        const e = esc();
        win.dispatchEvent(e);
        expect(open).toBe(false);
        expect(editSaw).toBe(0);
        expect(e.defaultPrevented).toBe(true);
    });
    it('the panel closed: the Esc goes on to the edit mode (or the pause)', () => {
        const win = new EventTarget();
        let editSaw = 0;
        const f = make();
        expect(typeof f).toBe('function');
        win.addEventListener('keydown', f!(() => false, () => {}) as EventListener, true);
        win.addEventListener('keydown', () => { editSaw++; }, true);
        win.dispatchEvent(esc());
        expect(editSaw).toBe(1);
    });
});
