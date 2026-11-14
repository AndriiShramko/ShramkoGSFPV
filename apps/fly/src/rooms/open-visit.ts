// Lane rooms2, review RM-4: an open room flies the catalogue's scene size and walls. Poses are flown-world positions
// (rooms/pose.ts) and a race's seed course is generated on the flown walls, so pilots with their own stored size would
// see the others in the wrong place and race different courses. The store's visit layer (PrefsStore.setVisit, the
// layer a shared link and a temporary room use) holds the defaults for that scan while the pilot is in the open room;
// a setting he changes himself there leaves the layer (his choice wins), and leaving the room clears what was set.
import type { PrefsStore } from '@gsfpv/prefs';

/** The settings an open room aligns: the scene's size and place, and the walls switch. */
export const OPEN_VISIT_IDS = ['scene.transform', 'scene.walls'] as const;

/** The identity transform, for a scan whose stored default is none (the size the catalogue gives). */
const IDENTITY = { s: 1, t: [0, 0, 0], v: 0 };

/** Puts the defaults of `scene` into the visit layer; returns the ids the store took. */
export function openVisit(prefs: Pick<PrefsStore, 'setVisit' | 'defaultOf'>, scene: string): string[] {
    const set: string[] = [];
    for (const id of OPEN_VISIT_IDS) {
        const d = prefs.defaultOf(id, { scene });
        const v = id === 'scene.transform' && (d === null || d === undefined) ? IDENTITY : d;
        if (prefs.setVisit(scene, id, v).ok) set.push(id);
    }
    return set;
}

/** Leaving the open room: the pilot's own values read again. */
export function closeVisit(prefs: Pick<PrefsStore, 'clearVisit'>, scene: string, ids: readonly string[]): void {
    for (const id of ids) prefs.clearVisit(scene, id);
}
