// Train 4, integration car 2 (int4, S2): ux4a's message stack x the top row (ui/top-row.ts watchTopRow).
// ux4a-messages step 6 at 1536x730 on the release build, two runs of three: a new message (471 px wide, centred) lay over the
// top-row buttons (the row from x 892) for 2.9 s. The stack keeps class hud-note, so the top row moves it under the buttons
// (#ui.note-crowded), but the size change waited for the next animation frame, and a frame with the scan took seconds.
// The observer's callback now lays out at once, before the frame that first shows the message is painted.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchTopRow } from '../../../apps/fly/src/ui/top-row';

/** Just what layoutTopRow reads and writes: the row, the note (no walls box), the class list and the style of #ui. */
function fakeUi() {
    const classes = new Set<string>();
    const vars = new Map<string, string>();
    const row = { offsetParent: {}, getBoundingClientRect: () => ({ left: 892, right: 1520, top: 38, bottom: 82, width: 628, height: 44 }) };
    const note = { hidden: true, offsetParent: null as object | null, offsetWidth: 0 };
    const ui = {
        querySelector: (sel: string) => (sel.includes('top-actions') ? row : sel.includes('hud-note') ? note : null),
        querySelectorAll: () => [row, note],
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 1536, bottom: 730, width: 1536, height: 730 }),
        classList: {
            contains: (c: string) => classes.has(c),
            toggle: (c: string, on?: boolean) => { const v = on ?? !classes.has(c); if (v) classes.add(c); else classes.delete(c); return v; },
        },
        style: { getPropertyValue: (k: string) => vars.get(k) ?? '', setProperty: (k: string, v: string) => { vars.set(k, v); } },
    };
    return { ui, note, classes };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('int4: ux4a message stack x top row', () => {
    it('a message that grows to meet the row goes under it in the observer\'s callback, not a frame later', () => {
        let resized: (() => void) | null = null;
        const frames: Array<() => void> = [];
        vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { resized = cb; } observe() {} });
        vi.stubGlobal('MutationObserver', class { observe() {} });
        vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { frames.push(cb); return frames.length; });
        vi.stubGlobal('addEventListener', () => {});
        const { ui, note, classes } = fakeUi();
        watchTopRow(ui as unknown as HTMLElement);
        frames.splice(0).forEach((f) => f()); // the first layout: no message, nothing crowded
        expect(classes.has('note-crowded')).toBe(false);

        // the stack shows a line 471 px wide, centred on 1536: its right edge 1004 is past the row's left 892
        Object.assign(note, { hidden: false, offsetParent: {}, offsetWidth: 471 });
        expect(resized).not.toBeNull();
        resized!();
        expect(classes.has('note-crowded')).toBe(true); // no frame has run since
        expect(frames).toHaveLength(0);

        // and back: the stack empties, the class goes in the same callback
        Object.assign(note, { hidden: true, offsetParent: null, offsetWidth: 0 });
        resized!();
        expect(classes.has('note-crowded')).toBe(false);
    });
});
