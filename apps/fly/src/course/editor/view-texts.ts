// Lane edit4a A2: the words of the edit view's own tags (locales fly/course-view, keys course.view.*). Pure: no DOM and no
// i18n here, so the unit tests load it; view-mouse.ts turns a key into words through its host.
import type { Handle, HandleAxis } from './handle-look';

/** the tag at the cursor over a handle: 'Move along X', 'Turn around Y', 'Size'; the tag after a cancelled drag */
export const VIEW_TEXT_KEYS = {
    move: 'course.view.handle.move',
    turn: 'course.view.handle.turn',
    size: 'course.view.handle.size',
    cancelled: 'course.view.cancelled'
} as const;

/** every key this part uses (the locale test checks all four languages have them) */
export const viewLocaleKeys = (): string[] => Object.values(VIEW_TEXT_KEYS);

/** the key and its variables for the part of the gizmo under the cursor */
export function handleTextKey(handle: Handle, axis: HandleAxis): { key: string; vars: Record<string, string> } {
    return { key: VIEW_TEXT_KEYS[handle], vars: { axis: axis === 'xyz' ? 'XYZ' : axis.toUpperCase() } };
}
