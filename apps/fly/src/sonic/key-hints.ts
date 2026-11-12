// The pilot's "Key hints at the start of each step" (lane sonic-hints; the owner's complaint of 2026-11-10: "which key takes me to
// the next step"): brief (the default) says one short line of keys after the first line of every lesson step (lessons.ts), off says
// none. Kept in the prefs collection 'sonic' beside the panels' switches (packages/prefs doc.ts SonicState.keyHints: absent means
// brief, so an older document hears the hints), offered by the spoken settings list (start-screen.ts).
import type { LookHost } from './look-prefs';

export type KeyHintsChoice = 'brief' | 'off';
export const KEY_HINTS_CHOICES: readonly KeyHintsChoice[] = ['brief', 'off'];

/** The hints are said: true unless the pilot turned them off. */
export function keyHintsOn(host: LookHost): boolean {
    return host.collection('sonic').keyHints !== false;
}

/** The choice as the settings list shows it. */
export function keyHintsChoice(host: LookHost): KeyHintsChoice {
    return keyHintsOn(host) ? 'brief' : 'off';
}

/** Sets the choice (saved only when it changes). */
export function setKeyHints(host: LookHost, choice: KeyHintsChoice): void {
    const on = choice !== 'off';
    if (keyHintsOn(host) === on) return;
    host.updateCollection('sonic', (d) => {
        d.keyHints = on;
    });
}
