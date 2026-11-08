// The two panels' switches (v0.13 lane v13-look L2-3): the sound panel (M41-25) and the attitude display (M41-24), each on unless
// the pilot turned it off. Kept in the prefs collection 'sonic' beside the pilot's sound settings and lesson progress
// (packages/prefs doc.ts SonicState.soundPanel / .attitude: absent means on, so a v0.12 document shows both), so they travel with
// the settings file and need no catalogue rows, like the rest of the mode's. The spoken settings list offers them (the lead's merge
// with v13-host's stage C: docs/wip/v13-look.md, "For the lead"); the panels follow a change at once (look-panels.ts).
import type { PrefsStore } from '@gsfpv/prefs';

export type LookPanel = 'soundPanel' | 'attitude';
export const LOOK_PANELS: readonly LookPanel[] = ['soundPanel', 'attitude'];

/** What the switches need of the page's PrefsStore (a fake or a store on memory in tests). */
export type LookHost = Pick<PrefsStore, 'collection' | 'updateCollection'>;

/** The panel is on: true unless the pilot turned it off. */
export function panelOn(host: LookHost, which: LookPanel): boolean {
    return host.collection('sonic')[which] !== false;
}

/** Turns a panel on or off (saved only when it changes). */
export function setPanel(host: LookHost, which: LookPanel, on: boolean): void {
    if (panelOn(host, which) === on) return;
    host.updateCollection('sonic', (d) => {
        d[which] = on;
    });
}
