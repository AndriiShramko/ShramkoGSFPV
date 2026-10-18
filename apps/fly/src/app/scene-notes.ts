// The strip of small notes about the scene over the flight, bottom centre (v0.9 lane C): the chip for the
// settings a shared link brought (builtin/shared-settings.ts) and the one-time macro hint (builtin/scale.ts).
// One container, so two notes at once stack instead of covering each other; each note is its own element
// with its own buttons. The HUD's flash() is one slot that the next message overwrites, which is why these
// are not flashes: the pilot decides (Keep / Reset, Got it) or the note leaves by itself after a while.
import { h } from '../ui/dom';

/** The container under `ui`, made on first use. */
export function sceneNotes(ui: HTMLElement): HTMLElement {
    let box = ui.querySelector<HTMLElement>(':scope > .scene-notes');
    if (!box) {
        box = h('div', { class: 'scene-notes' });
        ui.append(box);
    }
    return box;
}

/** Adds `note` to the strip; it leaves after `ms` (0: stays until `remove()`). Returns its remover. */
export function addSceneNote(ui: HTMLElement, note: HTMLElement, ms = 0): () => void {
    const box = sceneNotes(ui);
    note.classList.add('scene-note');
    box.append(note);
    let timer = 0;
    const remove = (): void => {
        clearTimeout(timer);
        note.remove();
        if (!box.childElementCount) box.remove();
    };
    if (ms > 0) timer = window.setTimeout(remove, ms);
    return remove;
}
