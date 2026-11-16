// The walls and voxel panel's place on the screen (lane voxview, V4; the owner's message 60: on a small
// laptop screen the panel could not be closed and ran out of the view). The panel opens from the walls
// chip on the credit line: above the chip when the chip is in the lower half of the view, under it
// otherwise; its height is the room left on that side and it scrolls inside itself. When that room is
// too small for the header and a few rows, the panel covers the view with a margin, so its close
// button is always on screen. Pure: the DOM side is in walls.ts.

export interface PanelRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface PanelPlace {
    left: number;
    /** one of top and bottom is set (px from that edge of the view); the other is null */
    top: number | null;
    bottom: number | null;
    width: number;
    maxHeight: number;
}

/** margin to the view's edges, px (a layout choice) */
export const PANEL_MARGIN = 8;
/** gap between the chip and the panel, px (a layout choice) */
export const PANEL_GAP = 4;
/** the panel's width when the view has room, px (a layout choice: the old menu was 250 px plus padding) */
export const PANEL_WIDTH = 280;
/** below this room the panel covers the view: the header (44 px targets) and about four rows (a layout choice) */
export const PANEL_MIN_ROOM = 200;
/** the close and fold buttons' side, px: the smallest touch target the owner's rule asks for */
export const PANEL_TARGET_PX = 44;

export function placePanel(chip: PanelRect, viewW: number, viewH: number): PanelPlace {
    const m = PANEL_MARGIN;
    const width = Math.max(0, Math.min(PANEL_WIDTH, viewW - 2 * m));
    const left = Math.max(m, Math.min(chip.left, viewW - m - width));
    const lower = chip.top + chip.bottom > viewH;
    const room = lower ? chip.top - PANEL_GAP - m : viewH - chip.bottom - PANEL_GAP - m;
    if (room < PANEL_MIN_ROOM) return { left, top: m, bottom: null, width, maxHeight: Math.max(0, viewH - 2 * m) };
    if (lower) return { left, top: null, bottom: viewH - chip.top + PANEL_GAP, width, maxHeight: room };
    return { left, top: chip.bottom + PANEL_GAP, bottom: null, width, maxHeight: room };
}

/**
 * Lane voxview2 V7: Esc closes one thing at a time, the top one. The panel's keydown listener sits on the window in the
 * capture phase; the edit mode (course/editor/view-mouse.ts, top-bar.ts) listens there too, so stopPropagation alone
 * let the same Esc also leave the edit mode. stopImmediatePropagation stops the window's other listeners as well
 * (the panel's listener is added when the scene's walls are built, before the edit mode opens).
 */
export function panelEsc(isOpen: () => boolean, close: () => void): (e: KeyboardEvent) => void {
    return (e) => {
        if (e.key !== 'Escape' || !isOpen()) return;
        close();
        e.stopImmediatePropagation();
        e.preventDefault();
    };
}
