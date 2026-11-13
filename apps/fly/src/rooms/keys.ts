// Train 1, lane rooms (review RV-1): the two keys of the feature while it hides behind ?rooms=1. Their keymap lines stay
// 'planned', so on an ordinary page the router never sees the chords (Shift held to descend plus O still opens the settings,
// plus L still shares) and the key list does not offer dead keys. On a page that shows the feature this listener takes
// Shift+L and Shift+O in the capture phase, before the router, and stops the press there. When ROOMS_MENU_PUBLIC flips the
// lead flips the two keymap lines to shipped and builtin/rooms.ts goes back to ctx.keys.on (docs/wip/rooms.md, "For the lead").

export type RoomsAction = 'rooms.panel' | 'rooms.who';

interface Press { code: string; shiftKey: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }

/** The rooms action of a press: Shift+L or Shift+O with no Ctrl, Alt or Meta; else null. */
export function roomsChord(e: Press): RoomsAction | null {
    if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return null;
    return e.code === 'KeyL' ? 'rooms.panel' : e.code === 'KeyO' ? 'rooms.who' : null;
}

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * Listen to the two chords on `target` (the window) in the capture phase. `run` gets the action and the event and says
 * whether it took the press; a press it took goes no further (no router, no flying key). Returns the unlisten.
 */
export function listenRoomsKeys(target: Target, run: (action: RoomsAction, e: KeyboardEvent) => boolean): () => void {
    const onKey = (ev: Event): void => {
        const e = ev as KeyboardEvent;
        const action = roomsChord(e);
        if (action === null || !run(action, e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    };
    target.addEventListener('keydown', onKey, true);
    return () => target.removeEventListener('keydown', onKey, true);
}
