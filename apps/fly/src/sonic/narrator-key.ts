// Train 3, lane quiet (the owner's message 54, the lead's Q4): one key switches the narrator off and on during a flight in the sound
// mode. The change goes through the same path the start screen's 'Narrator' check uses (SonicEntry.update: checked, applied at
// once, saved), so the pause menu and the sound panel show it at their next look. Switching on is confirmed by two words, switching
// off by a sound alone (with the narrator off a word would be the very thing the pilot switched off).

/** What the key needs from the page. */
export interface NarratorKeyDeps {
    /** the narrator now (SonicPrefs.narrator: absent or true is on) */
    on(): boolean;
    /** set it, applied and saved; false when the settings refused the change (nothing changed) */
    set(on: boolean): boolean;
    /** the two words "Narrator on" (said after the change, so the narrator is on when it is said) */
    sayOn(): void;
    /** the short sound of "narrator off" */
    cueOff(): void;
}

/** The key's handler: a held key's repeats do nothing, each press flips the narrator once. */
export function narratorKey(d: NarratorKeyDeps): (e: Pick<KeyboardEvent, 'repeat'>) => void {
    return (e) => {
        if (e.repeat) return;
        const next = !d.on();
        if (!d.set(next)) return;
        if (next) d.sayOn();
        else d.cueOff();
    };
}
