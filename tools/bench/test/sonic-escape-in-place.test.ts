// Train 3, lane sonic3, decision c of the lead: switched on in place, Escape shows the simulator's pause menu (with "Switch off
// Fly by Sound" in it) as P does: one menu, the fewest presses. In a lesson opened from the lessons page Escape still opens the
// lesson menu and P the pause menu.
import { describe, expect, it } from 'vitest';
import { pauseKey } from '../../../apps/fly/src/sonic/lesson-menu';

function rig(inPlace: boolean): { press: (code: string) => void; lessonMenus: number; pauseMenus: number } {
    const r = { lessonMenus: 0, pauseMenus: 0, press: (code: string) => undefined as void };
    const key = pauseKey({ open: () => { r.lessonMenus++; } }, () => { r.pauseMenus++; }, () => inPlace);
    r.press = (code) => key({ code, repeat: false });
    return r;
}

describe('the pause key of Fly by Sound', () => {
    it('in place: Escape and P both open the pause menu, never the lesson menu', () => {
        const r = rig(true);
        r.press('Escape');
        r.press('KeyP');
        expect(r.pauseMenus).toBe(2);
        expect(r.lessonMenus).toBe(0);
    });

    it('in a lesson: Escape opens the lesson menu, P the pause menu (as before)', () => {
        const r = rig(false);
        r.press('Escape');
        r.press('KeyP');
        expect(r.lessonMenus).toBe(1);
        expect(r.pauseMenus).toBe(1);
    });
});
