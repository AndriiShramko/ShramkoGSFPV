// The top edge of the flight view, middle and right. The buttons row (.top-actions: the REC dot
// while recording, Share, Settings, Feedback, Controls, Pause; app/builtin/top.ts and share.ts)
// grows from the right edge; the walls box (.bake-box, walls.ts: "Scan without walls", "Build
// walls") and the recording's author notice (.rec-notice, app/builtin/cinema.ts) sit in the middle.
// How far the row reaches depends on the window, the language and whether a recording runs, so no
// fixed breakpoint keeps them apart: this measures the row and the box and tells fly.css where
// they are (#ui.top-crowded, --top-row-bottom, --bake-bottom). Text never prints over text.
// Installed once by the HUD (ui/hud.ts, Hud.mount) next to the banner stack. The mode chip's search
// for a free place at the left gutter (ui/mode-chip.ts) is here too: the same row is in its way.
// No imports and no DOM at load, so Node tests run the geometry.

/** The space kept between the walls box and the buttons row, in CSS pixels. */
export const TOP_GAP = 8;

/**
 * Whether the walls box, centred on a view `viewW` wide and `boxW` wide, would meet the buttons
 * row that starts at `rowLeft` (both measured from the view's left edge). Pure, so Node tests run it.
 * A box or a row of no width (hidden, empty) meets nothing.
 */
export function boxMeetsRow(viewW: number, boxW: number, rowLeft: number, gap = TOP_GAP): boolean {
    if (boxW <= 0 || rowLeft >= viewW) return false;
    return viewW / 2 + boxW / 2 + gap > rowLeft;
}

/** A box on the page, as getBoundingClientRect gives it (only the edges are read). */
export interface Box { left: number; right: number; top: number; bottom: number }

/** Area two boxes share, the chip at (x, y) of `w` x `ch` grown by `gap` sideways; 0 when apart. */
export function overlapArea(x: number, y: number, w: number, ch: number, b: Box, gap: number): number {
    const ox = Math.min(x + w + gap, b.right) - Math.max(x - gap, b.left);
    const oy = Math.min(y + ch, b.bottom) - Math.max(y, b.top);
    return ox > 0.5 && oy > 0.5 ? ox * oy : 0;
}

/**
 * The first free height for the chip at the left gutter `x`, going down from `start` past
 * everything in its way: the top buttons and the right-hand OSD line (`hard`, 4 px apart) and the
 * boxes and notes (`soft`), never below `limit` (the middle of the screen). On a phone the row of
 * top buttons spans the width right under the OSD line, so the chip goes under the row (it used to
 * stop under the soft boxes only and land under the buttons). Pure, so Node tests run it.
 */
export function gutterTop(x: number, start: number, w: number, ch: number, hard: readonly Box[], soft: readonly Box[], limit: number): number {
    let y = start;
    for (let moved = true; moved && y < limit;) {
        moved = false;
        for (const r of hard) if (overlapArea(x, y, w, ch, r, 4) > 0) { y = r.bottom + 4; moved = true; }
        for (const r of soft) if (overlapArea(x, y, w, ch, r, 1) > 0) { y = r.bottom + 4; moved = true; }
    }
    return y;
}

function px(ui: HTMLElement, name: string, v: number): void {
    const s = `${Math.round(v)}px`;
    if (ui.style.getPropertyValue(name) !== s) ui.style.setProperty(name, s);
}

/** Measure the row and the box now and update the class and the two variables on `ui`. */
export function layoutTopRow(ui: HTMLElement): void {
    const row = ui.querySelector<HTMLElement>(':scope > .top-actions');
    const box = ui.querySelector<HTMLElement>(':scope > .bake-box');
    const u = ui.getBoundingClientRect();
    const r = row && row.offsetParent !== null ? row.getBoundingClientRect() : null;
    const boxW = box && box.offsetParent !== null ? box.offsetWidth : 0;
    const crowded = !!r && r.width > 0 && boxMeetsRow(u.width, boxW, r.left - u.left);
    if (ui.classList.contains('top-crowded') !== crowded) ui.classList.toggle('top-crowded', crowded);
    if (r && r.height > 0) px(ui, '--top-row-bottom', r.bottom - u.top);
    // where the row starts: on a phone on its side the credit shares the row's height and ends before it (fly.css)
    if (r && r.width > 0) px(ui, '--top-row-left', r.left - u.left);
    // after the class: the box may just have moved under the row
    const b = boxW > 0 && box ? box.getBoundingClientRect() : null;
    px(ui, '--bake-bottom', b && b.height > 0 ? b.bottom - u.top : 0);
    // the short note a key leaves (H, C, V; ui/hud.ts flash) is centred at the top like the box: when
    // it would meet the row (a wide row: the speaker of v0.8, a long language), fly.css puts it under
    // the row and the box
    const note = ui.querySelector<HTMLElement>(':scope > .hud-note');
    const noteW = note && !note.hidden && note.offsetParent !== null ? note.offsetWidth : 0;
    const noteCrowded = !!r && r.width > 0 && boxMeetsRow(u.width, noteW, r.left - u.left);
    if (ui.classList.contains('note-crowded') !== noteCrowded) ui.classList.toggle('note-crowded', noteCrowded);
}

/**
 * Keep the layout current: the row and the box change size (a recording starts, a language
 * changes, a bake reports progress, the box hides while flying), the window resizes, and both
 * are put on the page after the HUD.
 */
export function watchTopRow(ui: HTMLElement): void {
    let queued = false;
    const again = (): void => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; layoutTopRow(ui); });
    };
    const sizes = new ResizeObserver(again);
    const observe = (): void => {
        for (const el of ui.querySelectorAll(':scope > .top-actions, :scope > .bake-box, :scope > .hud-note')) sizes.observe(el);
    };
    new MutationObserver(() => { observe(); again(); }).observe(ui, { childList: true });
    addEventListener('resize', again);
    observe();
    again();
}
