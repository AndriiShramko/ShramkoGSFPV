// The share code on the page's own store (app/prefs.ts pagePrefs): a picker card and a flight both ask here
// what a share of a scene carries. The rules are share/shared.ts's, which takes the store as an argument.
import type { SharedSettings } from '@gsfpv/scenes';
import { pagePrefs } from '../app/prefs';
import { drawingPick, sharedOf } from './shared';
import type { SharedScene } from './shared';
import type { DrawingPick } from './links';

/** What a share of `sceneId` carries of the pilot's scene settings; empty before the store is open or when it cannot be read. */
export function sharedOfPage(sceneId: string, scene: SharedScene = {}): SharedSettings {
    const prefs = pagePrefs();
    if (!prefs) return {};
    try {
        return sharedOf(prefs, sceneId, scene);
    } catch {
        return {};
    }
}

/** The pilot's own Display drawing choice, when a share should carry it (shared.ts drawingPick). */
export function drawingPickOfPage(): DrawingPick {
    const prefs = pagePrefs();
    return prefs ? drawingPick(prefs) : undefined;
}
