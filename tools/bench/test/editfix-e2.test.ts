// Lane editfix E2 (docs/wip/editfix.md): the owner's report of 2026-11-16, "I entered the editing and cannot move around the
// scene, cannot select a gate, Add gate shows nothing, Exit does nothing; the menu bar hangs at the top". E1 measured three
// causes; each test here fails on the code as it was (origin/main 88ee98c3).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as flyMode from '../../../apps/fly/src/course/editor/fly-mode';

const SRC = join(__dirname, '../../../apps/fly/src');
const read = (p: string): string => readFileSync(join(SRC, p), 'utf8');
const COURSE_TS = read('app/builtin/course.ts');
const VIEW_TS = read('course/editor/view-mouse.ts');
const TOP_TS = read('course/editor/top-bar.ts');
const CSS = read('course/editor/editor.css');

describe('editfix cause 1: Shift+B in the air opens the edit view, not the flight', () => {
    const openStep = (flyMode as { openStep?: (armed: boolean) => { hold: boolean; respawn: boolean } }).openStep;

    it('an armed drone: the hold is set, the drone goes to the start, and the first frames stay in the edit view', () => {
        expect(typeof openStep).toBe('function');
        const os = openStep!(true);
        expect(os).toEqual({ hold: true, respawn: true });
        // the frames after the open: still armed (the drone hovers or sits at the start), then disarmed by the landing, then
        // armed again by Space or the switch: only that fresh arm flies
        let st = flyMode.modeStep('edit', true, false, os.hold);
        expect(st.mode).toBe('edit');
        st = flyMode.modeStep(st.mode, true, false, st.hold);
        expect(st.mode).toBe('edit');
        st = flyMode.modeStep(st.mode, false, false, st.hold);
        expect(st.mode).toBe('edit');
        st = flyMode.modeStep(st.mode, true, false, st.hold);
        expect(st).toMatchObject({ mode: 'fly', change: 'to-fly' });
    });

    it('a drone on the ground: nothing held, nothing moved (as before)', () => {
        expect(openStep!(false)).toEqual({ hold: false, respawn: false });
    });

    it('course.ts openEdit takes the hold and the respawn from openStep, not crashHold = false', () => {
        const open = COURSE_TS.slice(COURSE_TS.indexOf('const openEdit = ('), COURSE_TS.indexOf('function closeEdit('));
        expect(open).toMatch(/openStep\(!!ctx\.session\.sim\?\.armed\)/);
        expect(open).toMatch(/crashHold = os\.hold;/);
        expect(open).toMatch(/if \(os\.respawn\) ctx\.session\.respawnStart\(\);/);
        expect(open).not.toMatch(/crashHold = false;/);
    });

    // lane edit4b (E5): Back to editing (the Fly the course button while flying) stays beside Exit
    it('while the course is flown in the mode, Exit and Back to editing stay on the bar and take a click', () => {
        expect(CSS).toMatch(/\.ce-topbar\.flying \.ce-tb:not\(\[data-top='exit'\]\):not\(\[data-top='fly'\]\) \{ display: none; \}/);
        expect(CSS).toMatch(/\.ce-topbar\.flying \.ce-tb\[data-top='exit'\] \{ pointer-events: auto; \}/);
        expect(CSS).toMatch(/\.ce-topbar\.flying \.ce-tb\[data-top='fly'\] \{ pointer-events: auto; \}/);
        expect(CSS).not.toMatch(/\.ce-topbar\.flying \.ce-tb \{ display: none; \}/);
    });
});

describe('editfix cause 2: the top bar does not move under a press', () => {
    it('a held line is cleared when the press is let go (pointerup), not when it goes down', () => {
        expect(TOP_TS).toMatch(/addEventListener\('pointerup', this\.onAct, true\)/);
        expect(TOP_TS).not.toMatch(/addEventListener\('pointerdown', this\.onAct/);
        expect(TOP_TS).toMatch(/removeEventListener\('pointerup', this\.onAct, true\)/);
    });
});

describe('editfix E2.4: Courses and Keys on the top bar always have a visible effect', () => {
    const PANEL_TS = read('course/editor/panel.ts');

    it('reveal() lights the part it shows (also when it was already on screen)', () => {
        const rev = PANEL_TS.slice(PANEL_TS.indexOf('    reveal(part:'), PANEL_TS.indexOf('    names():'));
        expect(rev).toContain("flashPart(part === 'courses' ? this.rows : at);");
        expect(CSS).toMatch(/\.course-editor \.ce-shown \{[^}]*outline: 2px solid/);
    });

    it('the light goes on at once, a second press starts it again, and it goes off after SHOWN_MS', async () => {
        const flash = (await import('../../../apps/fly/src/course/editor/flash')) as typeof import('../../../apps/fly/src/course/editor/flash');
        const on = new Set<string>();
        const log: string[] = [];
        const part = { classList: { add: (c: string) => { on.add(c); log.push(`+${c}`); }, remove: (c: string) => { on.delete(c); log.push(`-${c}`); } }, offsetWidth: 10 };
        const due: { fn: () => void; ms: number; stopped: boolean }[] = [];
        const later = (fn: () => void, ms: number): number => { due.push({ fn, ms, stopped: false }); return due.length - 1; };
        const stop = (id: unknown): void => { due[id as number].stopped = true; };
        flash.flashPart(part, later, stop);
        expect(on.has(flash.SHOWN_CLASS)).toBe(true);
        expect(due[0].ms).toBe(flash.SHOWN_MS);
        flash.flashPart(part, later, stop);
        expect(due[0].stopped).toBe(true);
        expect(log.slice(-2)).toEqual([`-${flash.SHOWN_CLASS}`, `+${flash.SHOWN_CLASS}`]);
        due[1].fn();
        expect(on.has(flash.SHOWN_CLASS)).toBe(false);
    });
});

describe('editfix cause 3: a right drag on the handles turns the view', () => {
    it('the three gizmos take the left button only', () => {
        expect(VIEW_TS).toMatch(/export const HANDLE_BUTTONS: readonly \[boolean, boolean, boolean\] = \[true, false, false\];/);
        expect(VIEW_TS).toContain('for (const g of [move, turn, size]) g.mouseButtons.splice(0, 3, ...HANDLE_BUTTONS);');
    });
});
